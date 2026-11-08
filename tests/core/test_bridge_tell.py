"""The festival manager tells a person something: the five ways, and what the person makes of it."""

import json

import pytest
from bridge_helpers import state_of, step
from dealings_helpers import (
    LO,
    acks,
    act,
    believe,
    claim_of,
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
from player_helpers import plain
from voice_helpers import says

from lantern_core.cognition.beliefs import Belief, Claim
from lantern_core.cognition.relations import source_mismatch
from lantern_core.inputs import InputError
from lantern_core.world.bridge import lies, notebook, notes, repute, telling
from lantern_core.world.bridge.lore import PLAYER

LISTENER = (
    "cha_laoban"  # warmth 70 and suspicion 40: she believes a neighbour a little over their trust
)
BONUS = 6  # (70 - 50) // 5 - (40 - 50) // 5, what her nature adds to her trust in the teller
TRUST = 40
SEEN = telling.SEEN_WEIGHT  # what she adds to her belief in a thing she is told was seen


def room(prop_id="pr_boat_scratched", source="saw", teller=None, hop=1, seed=1, **config):
    """A conversation with the listener, and the entry for ``prop_id`` in the notebook."""
    game = talking(LISTENER, seed=seed, **config)
    trust(game, LISTENER, TRUST)
    entry = know(game, prop_id, source, teller, hop)
    return game, entry["id"]


def heard_by_her(game, prop_id):
    belief = stored(game, LISTENER, prop_id)
    assert belief is not None, prop_id
    return belief


# ------------------------------------------------------------------------------ the five ways


def test_telling_what_the_manager_saw_as_it_is_gives_the_listener_a_first_hand_report():
    game, entry = room("pr_boat_scratched")
    seq = state_of(game)["social"]["seq"]
    told_before = state_of(game)["social"]["counts"]["told"]
    out = tell(game, entry, "faithful")
    assert acks(out) == [("applied", None)]
    event = told_event(out)
    assert (event["speaker"], event["listener"], event["prop"]) == (
        PLAYER,
        LISTENER,
        "pr_boat_scratched",
    )
    assert (event["path"], event["modality"], event["op"]) == ("belief", "assert", None)
    assert (event["how"], event["outcome"]) == ("faithful", "took")
    claim = claim_of(game, f"c{seq}")
    assert (claim.speaker, claim.listeners, claim.claimed_source) == (
        PLAYER,
        (LISTENER,),
        "self_seen",
    )
    social = state_of(game)["social"]
    assert social["seq"] == seq + 1 and social["counts"]["told"] == told_before + 1
    belief = heard_by_her(game, "pr_boat_scratched")
    assert (belief.source, belief.teller, belief.claimed_source) == ("heard", PLAYER, "self_seen")
    assert (belief.hop, belief.claim) == (1, claim.id)
    assert belief.confidence == TRUST + BONUS + SEEN  # her trust, her nature, and a first-hand word
    assert me(game)["lies"] == [] and me(game)["told"][0][:4] == [claim.id, LISTENER] + [
        "pr_boat_scratched",
        "faithful",
    ]
    says(out, LISTENER, "took_in")


def test_telling_what_was_only_heard_names_the_person_it_came_from_and_is_a_hand_further():
    game, entry = room("pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    out = tell(game, entry, "faithful")
    assert told_event(out)["outcome"] == "took"
    claim = claim_of(game, told_event(out)["claim"])
    assert claim.claimed_source == "zhou_zhanggui" and claim.path == "belief"
    belief = heard_by_her(game, "pr_liner_damaged")
    assert (belief.hop, belief.claimed_source) == (3, "zhou_zhanggui")
    assert belief.confidence == TRUST + BONUS - 8 * 2  # two hands further than first-hand
    assert me(game)["lies"] == []  # telling it as it is, whatever it is, is never a lie


def test_telling_what_was_heard_as_if_seen_is_a_lie_about_the_source_that_is_believed_more():
    game, entry = room("pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    out = tell(game, entry, "as_seen")
    event = told_event(out)
    assert (event["path"], event["modality"], event["outcome"]) == ("lie", "lie", "took")
    claim = claim_of(game, event["claim"])
    assert claim.claimed_source == "self_seen" and claim.path == "lie"
    belief = heard_by_her(game, "pr_liner_damaged")
    assert belief.hop == 1 and belief.claimed_source == "self_seen"
    # first-hand: two hands closer than the same as it is, and a word that it was seen
    assert belief.confidence == TRUST + BONUS + SEEN
    assert belief.confidence - (TRUST + BONUS - 8 * 2) == 16 + SEEN
    (row,) = me(game)["lies"]
    assert row[:4] == [claim.id, LISTENER, "pr_liner_damaged", "as_seen"]


def test_a_claim_told_as_seen_weighs_more_than_the_same_claim_heard_or_with_no_source():
    # the same claim to the same listener, at the same hand, for each source the teller can name
    def believed(speaker, source, tags=frozenset()):
        claim = Claim("c0", speaker, (LISTENER,), "pr_liner_damaged", "assert", source, 0, "belief")
        return telling.confidence(LO, TRUST, tags, claim, 1, False)

    for speaker, tags in ((PLAYER, frozenset()), ("zhou_zhanggui", LO.tags["zhou_zhanggui"])):
        seen = believed(speaker, "self_seen", tags)
        heard = believed(speaker, "zhou_huoji", tags)
        hidden = believed(speaker, "unknown", tags)
        assert seen - heard == SEEN > 0  # the manager and a neighbour are believed alike
        assert heard - hidden == 10


def test_a_made_up_thing_said_to_have_been_seen_is_believed_where_the_same_with_no_source_is_not():
    # a manager who has made a few promises: the listener trusts them at 25
    believed = {}
    for source in ("self_seen", "unknown"):
        game, _ = room()
        trust(game, LISTENER, 25)
        out = tell(game, how="fabricate", pred="damaged", subject="zhou_dalang", object="t_rail",
                   source=source)  # fmt: skip
        believed[source] = heard_by_her(game, told_event(out)["prop"]).confidence
    assert believed["self_seen"] == 25 + BONUS + SEEN >= repute.BELIEVE_AT
    assert believed["unknown"] == 25 + BONUS - 10 < repute.BELIEVE_AT


def test_telling_what_the_manager_did_see_as_seen_is_the_truth_and_not_a_lie():
    game, entry = room("pr_boat_scratched")
    out = tell(game, entry, "as_seen")
    assert told_event(out)["path"] == "belief" and told_event(out)["modality"] == "assert"
    assert me(game)["lies"] == []


def test_telling_it_with_more_drama_is_a_retelling_by_sharpen_that_the_rules_allow():
    game, entry = room("pr_boat_damaged", "heard", "gengfu", hop=2)
    out = tell(game, entry, "sharpen")
    event = told_event(out)
    assert (event["path"], event["op"], event["outcome"]) == ("mutation", "sharpen", "took")
    shown = state_of(game)["social"]["props"][event["prop"]]
    assert event["prop"] == "pr_boat_damaged__sh"  # made on the way, a child of what was heard
    prop = notes.decode_prop(event["prop"], shown)
    assert (prop.parent, prop.op, prop.motive) == ("pr_boat_damaged", "sharpen", "on_purpose")
    belief = heard_by_her(game, event["prop"])
    assert belief.hop == 3 and belief.claimed_source == "gengfu"
    assert me(game)["lies"] == []


def test_a_sharper_version_the_script_has_is_the_one_told():
    game, entry = room("pr_li_damaged", "heard", "cha_laoban", hop=1)
    out = tell(game, entry, "sharpen")
    assert told_event(out)["prop"] == "pr_li_damaged_on_purpose"  # the script plants this step
    assert "pr_li_damaged_on_purpose" not in state_of(game)["social"]["props"]


def test_so_is_the_sharper_version_of_the_rumour_on_the_person_that_the_opening_tells():
    game, entry = room("pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    event = told_event(tell(game, entry, "sharpen"))
    assert event["prop"] == "pr_liner_damaged_on_purpose" and event["op"] == "sharpen"
    assert state_of(game)["social"]["props"] == {}
    belief = heard_by_her(game, event["prop"])
    assert belief.hop == 3 and belief.claimed_source == "zhou_zhanggui"


def test_a_thing_with_nothing_heavier_to_say_cannot_be_sharpened():
    game, entry = room("pr_rail_located")
    before = json.dumps(state_of(game)["social"], sort_keys=True)
    assert acks(tell(game, entry, "sharpen")) == [("rejected", "no_sharpen")]
    assert json.dumps(state_of(game)["social"], sort_keys=True) == before


def test_telling_it_without_the_source_says_unknown_and_is_believed_a_little_less():
    game, entry = room("pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    out = tell(game, entry, "hide_source")
    event = told_event(out)
    assert (event["path"], event["modality"], event["outcome"]) == ("belief", "assert", "took")
    assert claim_of(game, event["claim"]).claimed_source == "unknown"
    belief = heard_by_her(game, "pr_liner_damaged")
    assert (belief.teller, belief.claimed_source, belief.hop) == (PLAYER, "unknown", 3)
    assert (
        belief.confidence == TRUST + BONUS - 16 - 10
    )  # a hand further than first-hand, and no name
    assert me(game)["lies"] == []


def test_making_something_up_from_the_table_is_a_lie_with_a_prop_of_its_own():
    game, _ = room()
    out = tell(
        game, how="fabricate", pred="damaged", subject="zhou_dalang", object="t_rail", neg=False
    )
    event = told_event(out)
    assert event["prop"] == "fab__damaged__zhou_dalang__t_rail"
    assert (event["path"], event["modality"], event["outcome"]) == ("lie", "lie", "took")
    prop = notes.decode_prop(event["prop"], state_of(game)["social"]["props"][event["prop"]])
    assert (prop.pred, prop.args_dict(), prop.neg, prop.span) == (
        "damaged",
        {"who": "zhou_dalang", "what": "t_rail"},
        False,
        None,
    )
    claim = claim_of(game, event["claim"])
    assert claim.claimed_source == "self_seen" and claim.prop == event["prop"]
    assert me(game)["lies"][0][3] == "fabricate"
    assert notebook.by_prop(me(game), event["prop"]) is None  # nothing in the notebook backs it
    belief = heard_by_her(game, event["prop"])
    assert (belief.hop, belief.claimed_source) == (1, "self_seen")
    assert belief.confidence == TRUST + BONUS + SEEN  # made up, and said to have been seen
    assert "bad_claim" not in str(acks(out))


def test_a_made_up_denial_and_a_made_up_source_and_a_prop_the_script_has():
    game, _ = room()
    out = tell(game, how="fabricate", pred="at", subject="li_er", object="p_bridge", neg=True)
    assert told_event(out)["prop"] == "fab__at__li_er__p_bridge__not"
    assert notes.decode_prop(
        told_event(out)["prop"], state_of(game)["social"]["props"][told_event(out)["prop"]]
    ).neg
    out = tell(game, how="fabricate", pred="flood_damaged", subject="t_rail", source="unknown")
    assert claim_of(game, told_event(out)["claim"]).claimed_source == "unknown"
    out = tell(game, how="fabricate", pred="owns", subject="old_he", object="t_he_boat")
    assert told_event(out)["prop"] == "pr_he_owns_boat"  # the script has it: its own prop is used
    assert told_event(out)["outcome"] == "knew"  # and everyone knows who owns the boat


@pytest.mark.parametrize(
    "fields",
    [
        {"pred": "nothing", "subject": "li_er", "object": "p_bridge"},
        {"pred": "lied", "subject": "li_er"},  # the town's own words about the manager
        {"pred": "at", "subject": "p_bridge", "object": "li_er"},  # a place is no one
        {"pred": "at", "subject": "li_er"},  # where?
        {"pred": "gave", "subject": "li_er", "object": "li_da"},  # what was given?
        {"pred": "flood_damaged", "subject": "t_rail", "object": "p_bridge"},  # one slot only
        {"pred": "at", "subject": "player", "object": "p_bridge"},  # not an entity of the script
    ],
)
def test_a_claim_the_table_cannot_say_is_refused_and_writes_nothing(fields):
    game, _ = room()
    social = json.dumps(state_of(game)["social"], sort_keys=True)
    assert acks(tell(game, how="fabricate", **fields)) == [("rejected", "bad_claim")]
    assert json.dumps(state_of(game)["social"], sort_keys=True) == social and me(game)["lies"] == []


# ------------------------------------------------------------------------------ her side of it


def test_a_person_who_holds_it_already_is_not_written_over_and_nothing_changes():
    game, entry = room("pr_boat_scratched")
    believe(game, LISTENER, "pr_boat_scratched", 90, "saw")
    out = tell(game, entry, "as_seen")
    assert told_event(out)["outcome"] == "knew"
    belief = heard_by_her(game, "pr_boat_scratched")
    assert (belief.source, belief.confidence, belief.teller) == ("saw", 90, None)
    says(out, LISTENER, "knew")


def test_a_person_who_trusts_their_own_belief_more_does_not_take_it_in_and_catches_the_lie():
    game, _ = room()
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")  # she saw the boat do it
    out = tell(game, how="fabricate", pred="damaged", subject="zhou_dalang", object="t_rail")
    event = told_event(out)
    assert event["outcome"] == "caught"
    assert [e["kind"] for e in events(out, "conflict")] == ["conflict"]
    assert events(out, "conflict")[0]["kept"] == "held"
    assert heard_by_her(game, event["prop"]).confidence == 0  # set aside, and on record
    says(out, LISTENER, "caught")
    assert stored(game, LISTENER, "pr_boat_damaged").confidence == 90


def test_a_person_who_trusts_the_manager_more_takes_it_in_and_drops_what_it_contradicts():
    game, _ = room()
    believe(game, LISTENER, "pr_boat_damaged", 40, "heard", "old_he", "old_he")
    out = tell(game, how="fabricate", pred="damaged", subject="zhou_dalang", object="t_rail")
    assert told_event(out)["outcome"] == "took"
    assert events(out, "conflict")[0]["kept"] == "new"
    assert stored(game, LISTENER, "pr_boat_damaged").confidence == 0
    assert heard_by_her(game, told_event(out)["prop"]).confidence == TRUST + BONUS + SEEN


def test_a_person_who_agrees_with_it_already_believes_it_more():
    game, entry = room("pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    believe(game, LISTENER, "pr_liner_at_bridge", 60, "heard", "zhou_huoji", "self_seen")
    out = tell(game, entry, "faithful")
    assert told_event(out)["outcome"] == "took"
    # pr_liner_damaged was made from pr_liner_at_bridge, which she holds: it fits what she knows
    assert heard_by_her(game, "pr_liner_damaged").confidence == TRUST + BONUS - 16 + 10


def test_a_person_told_that_they_or_their_kin_did_wrong_trusts_the_manager_less_for_the_words():
    game = talking("li_da")
    trust(game, "li_da", 40)
    entry = know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)  # Li Er is his brother
    out = tell(game, entry["id"], "faithful")
    assert told_event(out)["outcome"] == "took" and trust_of(game, "li_da") == 40 - 6
    assert events(tell(game, entry["id"], "faithful"), "told")[0]["outcome"] == "knew"
    assert trust_of(game, "li_da") == 40 - 6  # the same words again are not an offence again
    other = talking("zhou_zhanggui")
    trust(other, "zhou_zhanggui", 40)
    entry = know(other, "pr_liner_damaged", "heard", "zhou_huoji", hop=2)
    tell(other, entry["id"], "faithful")
    assert trust_of(other, "zhou_zhanggui") == 40  # about the other house, and no offence to him
    fresh = talking("li_da")
    trust(fresh, "li_da", 40)
    denial = tell(
        fresh, how="fabricate", pred="damaged", subject="li_er", object="t_rail", neg=True
    )
    assert told_event(denial)["outcome"] == "took" and trust_of(fresh, "li_da") == 40  # no blame


def test_what_is_told_goes_into_the_talk_of_the_town_and_is_passed_on_in_the_name_of_the_manager():
    game, entry = room("pr_boat_scratched", seed=2)  # one where she tells it as it is, and soon
    trust(game, LISTENER, 90)
    assert told_event(tell(game, entry, "faithful"))["outcome"] == "took"
    act(game, "leave")
    social = state_of(game)["social"]
    social["next"] = [0] * len(social["next"])  # the town talks again
    told = None
    for _ in range(1500):
        step(game)
        told = next(
            (
                c
                for c in notes.claims(social).values()
                if c.speaker == LISTENER and c.prop == "pr_boat_scratched"
            ),
            None,
        )
        if told is not None:
            break
    assert told is not None, "she never passed it on"
    assert told.claimed_source == PLAYER  # the one who told her, who is named when she tells it
    heard = stored(game, told.listeners[0], "pr_boat_scratched")
    assert heard is not None and heard.teller == LISTENER and heard.hop == 2


def test_what_the_manager_said_reads_as_the_manager_said_it_in_both_languages():
    game, entry = room("pr_boat_scratched")
    out = tell(game, entry, "faithful")
    claim_id = told_event(out)["claim"]
    social = state_of(game)["social"]
    claim = claim_of(game, claim_id)
    said = LO.lines.say(
        notebook.view(social)[claim.prop],
        LO.names,
        modality=claim.modality,
        claimed_source=claim.claimed_source,
        speaker=PLAYER,
    )
    assert said["en"].startswith("I saw it myself") and said["zh"].startswith("我亲眼看见")
    # and when a neighbour says whom they heard it from, the manager has a name
    retold = LO.lines.say(
        notebook.view(social)[claim.prop],
        LO.names,
        modality="assert",
        claimed_source=PLAYER,
        speaker=LISTENER,
    )
    assert retold["en"].startswith("The Festival Manager told me that")
    assert retold["zh"].startswith("听总管说")


# ------------------------------------------------------------------------------ the action itself


def test_telling_needs_a_conversation_and_an_entry_of_the_notebook():
    game, _ = room()
    assert acks(tell(game, "n99", "faithful")) == [("rejected", "no_entry")]
    act(game, "leave")
    assert acks(tell(game, "n1", "faithful")) == [("rejected", "not_talking")]


@pytest.mark.parametrize(
    "fields",
    [
        {"how": "boast", "entry": "n1"},
        {"how": "faithful"},
        {"how": "faithful", "entry": 5},
        {"how": "fabricate", "pred": "at"},
        {"how": "fabricate", "pred": "at", "subject": "li_er", "neg": "yes"},
        {"how": "fabricate", "pred": "at", "subject": "li_er", "source": "a dream"},
        {"how": "fabricate", "pred": "at", "subject": "li_er", "object": 3},
    ],
)
def test_a_body_that_is_not_well_formed_is_an_error_before_anything_is_applied(fields):
    game, _ = room()
    with pytest.raises(InputError):
        act(game, "tell", **fields)


def test_a_telling_that_is_left_out_of_how_is_a_telling_as_it_is():
    game, entry = room("pr_boat_scratched")
    out = act(game, "tell", entry=entry)
    assert told_event(out)["how"] == "faithful" and told_event(out)["outcome"] == "took"


def test_the_state_stays_plain_and_the_ledger_of_tellings_is_kept():
    game, entry = room("pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    tell(game, entry, "as_seen")
    tell(game, how="fabricate", pred="at", subject="li_er", object="p_bridge", neg=True)
    plain(game._kernel.state)
    told = me(game)["told"]
    assert [row[3] for row in told] == ["as_seen", "fabricate"] and [row[4] for row in told] == [
        1,
        1,
    ]
    assert [row[0] for row in me(game)["lies"]] == [row[0] for row in told]


def test_the_exposure_ledger_knows_who_was_lied_to_and_who_caught_it():
    game, _ = room()
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")
    tell(game, how="fabricate", pred="damaged", subject="zhou_dalang", object="t_rail")
    uncaught = lies.uncaught_to(me(game), LISTENER)
    assert uncaught == [] and lies.is_caught(
        me(game), "fab__damaged__zhou_dalang__t_rail", LISTENER
    )


# ------------------------------------------------------------------------------ the way back


def test_a_trail_that_comes_back_to_the_manager_ends_there_with_nobody_left_to_ask():
    game, entry = room("pr_boat_scratched")
    tell(game, entry, "faithful")
    act(game, "leave")
    # a neighbour of hers tells the manager what the manager once told her, and names the manager
    heard = know(game, "pr_li_damaged", "heard", LISTENER, hop=2, claimed=PLAYER, tick=game.tick)
    shown = next(e for e in step(game)["frame"]["notebook"] if e["id"] == heard["id"])
    assert [name["id"] for name in shown["chain"]] == [LISTENER, PLAYER]  # and no null after it
    assert shown["chain"][1] == {"zh": "总管", "en": "Festival Manager", "id": PLAYER}
    assert notebook.frontier(notebook.find(me(game), heard["id"])) is None


def test_a_teller_who_names_the_manager_and_says_something_else_than_they_said_is_marked():
    game, entry = room("pr_li_damaged", "heard", "cha_laoban", hop=1)
    assert told_event(tell(game, entry, "faithful"))["outcome"] == "took"  # the Li family did it
    act(game, "leave")
    now, social_state = game.tick, state_of(game)["social"]
    view = notebook.view(social_state)
    claims = notebook.known_claims(me(game), social_state, view)
    assert [(c.speaker, c.listeners, c.prop) for c in claims] == [
        (PLAYER, (LISTENER,), "pr_li_damaged")
    ]  # the manager knows what they said
    said = Belief(PLAYER, "pr_li_damaged", "assert", 60, "heard", LISTENER, PLAYER, 2, now)
    heavier = Belief(
        PLAYER, "pr_li_damaged_on_purpose", "assert", 60, "heard", LISTENER, PLAYER, 2, now
    )
    other = Belief(PLAYER, "pr_li_damaged", "assert", 60, "heard", "li_er", PLAYER, 2, now)
    assert not source_mismatch(said, claims, view)  # she says what she was told
    assert source_mismatch(heavier, claims, view)  # and here she has changed it on the way
    assert not source_mismatch(other, claims, view)  # nothing is known of what was said to him
    entry = know(game, "pr_li_damaged_on_purpose", "heard", LISTENER, 2, PLAYER, now)
    shown = next(e for e in step(game)["frame"]["notebook"] if e["id"] == entry["id"])
    assert shown["marks"] == []  # the mismatch is for the manager to judge, not for the notebook
