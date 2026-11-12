"""Getting caught lying: only by what a person holds, and what it costs. Promises won by a lie."""

import pytest
from bridge_helpers import CAST, state_of, step
from dealings_helpers import (
    LO,
    acks,
    act,
    believe,
    events,
    know,
    me,
    stored,
    talking,
    tell,
    told_event,
    trust,
    trust_of,
)
from goals_helpers import Hand, sim_of
from player_helpers import beside, run_on, silence

from lantern_core.world.bridge import entrust, goals, lies, notes, repute, telling
from lantern_core.world.bridge.lore import PLAYER

LISTENER = "cha_laoban"
LIE = {"how": "fabricate", "pred": "damaged", "subject": "zhou_dalang", "object": "t_rail"}
LIE_PROP = "fab__damaged__zhou_dalang__t_rail"
# how far she believes the lie: her trust of 40, her nature, and the word that it was seen
BELIEVED = 46 + telling.SEEN_WEIGHT


def room(**config):
    game = talking(LISTENER, **config)
    trust(game, LISTENER, 40)
    return game


def told(game):
    return told_event(tell(game, **LIE))


def reopen(game):
    """Open a conversation with the listener again, wherever she has got to."""
    beside(game, LISTENER)
    silence(game)
    assert acks(act(game, "talk", npc=LISTENER)) == [("applied", None)]


# ------------------------------------------------------------------------------ by what they hold


def test_nobody_catches_a_lie_that_they_have_nothing_against():
    game = room()
    assert told(game)["outcome"] == "took"
    for _ in range(600):  # and nothing in the town knows better, however long it runs
        step(game)
    assert me(game)["caught"] == [] and trust_of(game, LISTENER) == 40
    assert not repute.believes(state_of(game)["social"], LISTENER, repute.LIED)


@pytest.mark.parametrize(
    ("held", "caught"),
    [(30, False), (BELIEVED - 1, False), (BELIEVED, True), (BELIEVED + 1, True), (95, True)],
)
def test_a_lie_is_caught_only_against_a_belief_the_person_holds_at_least_as_firmly(held, caught):
    game = room()
    believe(game, LISTENER, "pr_boat_damaged", held, "heard", "old_he", "old_he")
    assert (told(game)["outcome"] == "caught") is caught
    assert (len(me(game)["caught"]) == 1) is caught
    # the weaker of the two beliefs is the one set aside
    assert stored(game, LISTENER, "pr_boat_damaged").confidence == (held if caught else 0)


def test_a_person_who_does_not_know_the_manager_said_it_does_not_catch_them():
    game = room()
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")
    me(game)["lies"].append(
        ["c0", "li_er", LIE_PROP, "fabricate", 0]
    )  # a lie, told to someone else
    state_of(game)["social"]["props"][LIE_PROP] = "damaged|what:t_rail,who:zhou_dalang||0|||"
    sim = sim_of(Hand(game))
    # it reached her from a neighbour who named a neighbour, and she trusts her own eyes
    believe(game, LISTENER, LIE_PROP, 40, "heard", "zhou_huoji", "zhou_huoji")
    assert not lies.check(sim, LISTENER) and me(game)["caught"] == []
    # when the neighbour names the manager, she does know whose lie it is
    believe(game, LISTENER, LIE_PROP, 40, "heard", "zhou_huoji", PLAYER)
    assert lies.check(sim, LISTENER) and len(me(game)["caught"]) == 1


def test_a_lie_that_was_believed_is_caught_when_the_person_comes_to_know_better():
    game = room()
    assert told(game)["outcome"] == "took"
    act(game, "leave")
    believe(game, LISTENER, "pr_boat_damaged", BELIEVED + 4, "heard", "old_he", "old_he")
    assert me(game)["caught"] == []
    caught = []
    for _ in range(lies.LOOK_STRIDE + 1):
        caught += events(step(game), "lie_caught")
    assert [e["npc"] for e in caught] == [LISTENER]
    assert trust_of(game, LISTENER) == 40 - lies.EXPOSED_DROP


def test_a_person_who_trusts_the_manager_more_than_what_they_learn_does_not_catch_them():
    game = room()
    assert told(game)["outcome"] == "took"
    act(game, "leave")
    believe(game, LISTENER, "pr_boat_damaged", BELIEVED - 10, "heard", "old_he", "old_he")
    for _ in range(3 * lies.LOOK_STRIDE):
        step(game)
    assert me(game)["caught"] == []


def test_what_was_told_as_it_is_is_never_caught_whatever_it_turns_out_to_be():
    game = talking(LISTENER)
    trust(game, LISTENER, 40)
    entry = know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")  # she knows it was not Li Er
    out = tell(game, entry["id"], "faithful")
    assert told_event(out)["outcome"] == "doubted"  # she does not take it in
    assert me(game)["lies"] == [] and me(game)["caught"] == []
    assert trust_of(game, LISTENER) == 40  # and the manager lost nothing for passing on a hearsay


# ------------------------------------------------------------------------------ what it costs


def test_catching_the_manager_costs_their_trust_once_and_makes_a_fact_of_it():
    game = room()
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")
    out = tell(game, **LIE)
    assert told_event(out)["outcome"] == "caught"
    (event,) = events(out, "lie_caught")
    assert event["npc"] == LISTENER and event["trust"] == 40 - lies.EXPOSED_DROP
    belief = stored(game, LISTENER, repute.LIED)
    assert (belief.source, belief.confidence, belief.hop) == ("saw", repute.FIRST_HAND, 0)
    prop = notes.decode_prop(repute.LIED, state_of(game)["social"]["props"][repute.LIED])
    assert (prop.pred, prop.args_dict()) == ("lied", {"who": PLAYER})
    assert me(game)["wary"][repute.LIED] == [LISTENER]
    # the same lie again is nothing new: it is on record, and she is not caught twice
    assert events(tell(game, **LIE), "lie_caught") == [] and len(me(game)["caught"]) == 1
    for _ in range(3 * repute.WATCH_STRIDE):
        step(game)
    assert (
        trust_of(game, LISTENER) == 40 - lies.EXPOSED_DROP
    )  # and she does not pay for hearsay too


def test_the_trust_of_a_person_who_catches_the_manager_cannot_fall_below_nothing():
    game = room()
    trust(game, LISTENER, 10)
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")
    tell(game, **LIE)
    assert trust_of(game, LISTENER) == 0


def test_the_talk_of_the_town_carries_it_and_everyone_who_believes_it_trusts_the_manager_less():
    game = room()
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")
    tell(game, **LIE)
    act(game, "leave")
    social = state_of(game)["social"]
    social["next"] = [0] * len(social["next"])  # the town talks again
    for _ in range(9000):  # a person tells a story about once a game day, and it has to go round
        step(game)
    believers = [
        p
        for p in CAST.index
        if p != LISTENER and repute.believes(state_of(game)["social"], p, repute.LIED)
    ]
    assert len(believers) >= 3
    for person in believers:
        assert person in me(game)["wary"][repute.LIED]
        # a stranger's trust is 10, and a person pays for what they came to believe once
        assert trust_of(game, person) == 10 - repute.HEARSAY_DROP[repute.LIED]


def test_what_the_town_says_of_the_manager_reads_in_both_languages():
    game = room()
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")
    tell(game, **LIE)
    social = state_of(game)["social"]
    for pred, id_, en, zh in (
        (repute.LIED, "lied", "If you ask me, the Festival Manager lied.", "照我看，总管撒了谎。"),
        (
            repute.BROKE,
            "broke",
            "If you ask me, the Festival Manager broke their word.",
            "照我看，总管说话不算数。",
        ),
    ):
        prop = repute.prop(social, pred)
        said = LO.lines.say(
            prop, LO.names, modality="assert", claimed_source=LISTENER, speaker=LISTENER
        )
        assert (said["en"], said["zh"]) == (en, zh), id_


# ------------------------------------------------------------------------------ won by a lie


def ask_to_join(game):
    return act(game, "entrust", kind="join")


def test_a_yes_won_by_a_lie_waits_and_is_taken_back_if_the_person_learns_of_it():
    game = room()
    assert told(game)["outcome"] == "took"
    trust(game, LISTENER, 80)  # she would agree
    out = ask_to_join(game)
    (event,) = events(out, "entrusted")
    assert (event["result"], event["pending"]) == ("agreed", True)
    assert acks(out) == [("applied", None)]
    assert LISTENER not in goals.joined(state_of(game))  # nothing is done yet
    (row,) = me(game)["pending"]
    assert row["npc"] == LISTENER and row["kind"] == "join" and row["via"]
    key = f"asked:{LISTENER}|join|"
    assert key in me(game)["deeds"]
    # she learns that the manager lied, from a neighbour
    repute.prop(state_of(game)["social"], repute.LIED)
    believe(game, LISTENER, repute.LIED, 70, "heard", "li_er", "li_er")
    act(game, "leave")  # the world stands still in a conversation: the days go by outside it
    withdrawn = []
    for _ in range(entrust.PENDING_TICKS + 20):
        withdrawn += events(step(game), "entrust_withdrawn")
    assert [(e["npc"], e["request"]) for e in withdrawn] == [(LISTENER, "join")]
    assert LISTENER not in goals.joined(state_of(game)) and me(game)["pending"] == []
    assert key not in me(game)["deeds"]  # and the manager owes her nothing for it
    assert state_of(game)["goals"]["call"]["shift"][LISTENER] == 0  # nothing was ever done


def test_a_yes_won_by_a_lie_that_nobody_finds_out_is_acted_on_when_it_falls_due():
    game = room()
    assert told(game)["outcome"] == "took"
    trust(game, LISTENER, 80)
    ask_to_join(game)
    assert me(game)["pending"] and LISTENER not in goals.joined(state_of(game))
    act(game, "leave")  # the world stands still in a conversation: the days go by outside it
    done = []
    for _ in range(entrust.PENDING_TICKS + 20):
        done += events(step(game), "entrust_done")
    assert [(e["npc"], e["result"]) for e in done] == [(LISTENER, "done")]
    assert LISTENER in goals.joined(state_of(game)) and me(game)["pending"] == []
    assert LISTENER in me(game)["won"]


def test_the_same_yes_without_a_lie_is_acted_on_at_once():
    game = room()
    trust(game, LISTENER, 80)
    out = ask_to_join(game)
    (event,) = events(out, "entrusted")
    assert (event["result"], event["pending"]) == ("agreed", False)
    assert LISTENER in goals.joined(state_of(game)) and me(game)["pending"] == []


def test_a_lie_that_is_old_does_not_hold_a_yes_back():
    game = room()
    assert told(game)["outcome"] == "took"
    run_on(game, game.tick + entrust.TAINT_WINDOW + 5)
    reopen(game)
    trust(game, LISTENER, 80)
    assert events(ask_to_join(game), "entrusted")[0]["pending"] is False


def test_a_lie_that_was_caught_does_not_hold_a_yes_back_either():
    game = room()
    believe(game, LISTENER, "pr_boat_damaged", 95, "saw")
    assert told(game)["outcome"] == "caught"
    trust(game, LISTENER, 80)
    assert events(ask_to_join(game), "entrusted")[0]["pending"] is False


def test_a_yes_that_is_waiting_is_not_asked_for_again():
    game = room()
    assert told(game)["outcome"] == "took"
    trust(game, LISTENER, 80)
    assert events(ask_to_join(game), "entrusted")[0]["pending"] is True
    out = ask_to_join(game)
    assert acks(out) == [("rejected", "said_already")] and len(me(game)["pending"]) == 1


def test_two_lies_caught_in_one_look_are_both_caught_and_both_paid_for():
    game = room()
    alibi = {
        "how": "fabricate",
        "pred": "at",
        "subject": "li_er",
        "object": "p_bridge",
        "neg": True,
    }
    assert told(game)["outcome"] == "took"
    assert told_event(tell(game, **alibi))["outcome"] == "took"
    act(game, "leave")
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")  # it was not the kick
    believe(game, LISTENER, "pr_liner_at_bridge", 90, "saw")  # and Li Er was there
    caught = []
    for _ in range(lies.LOOK_STRIDE + 1):
        caught += events(step(game), "lie_caught")
    assert [e["npc"] for e in caught] == [LISTENER, LISTENER]
    assert sorted(row[0] for row in me(game)["caught"]) == sorted(
        [LIE_PROP, "fab__at__li_er__p_bridge__not"]
    )
    assert trust_of(game, LISTENER) == 0  # two payments of twenty-five, from forty
