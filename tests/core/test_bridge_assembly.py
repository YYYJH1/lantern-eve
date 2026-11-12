"""Speaking in public: where and when, who hears, who accepts, the elder, the table for two.

Showing evidence persuades and refutes but tells nothing by itself. The truth is told by the full
statement (``tell`` fills in the card with the right options of the story and makes it), which the
tests of the rule of acceptance, the elder and the table go through; the card has tests of its own
(``test_bridge_statement``). These tests speak in the first days, so the meeting of the fourth
evening is open to them (``the_meeting_is_open``).
"""

import pytest
from bridge_helpers import CAST, CLEAR, at, bridge, run_to, state_of, step
from dealings_helpers import acks, act, believe, events, me, stored, talking, trust, trust_of
from player_helpers import beside, plain, seed_of, silence
from statement_helpers import fill, state_it, stated, tell

from lantern_core.cognition.props import Prop
from lantern_core.inputs import InputError
from lantern_core.world.bridge import assembly, bonds, goals_ending, notebook, notes, persuade
from lantern_core.world.bridge.lore import lore

pytestmark = pytest.mark.usefixtures("the_meeting_is_open")
LO = lore()
DRUNK, BOAT = seed_of("v_drunk"), seed_of("v_boat")
KICK = ["e_gengfu_dalang"]  # alone it tells the drunken kick apart from the other two stories
BOAT_SET = ["e_xiaoman_testimony", "e_repair_record"]  # and these two tell the boat
GUESTS = ("li_laotai", "zhou_zhanggui", "cha_laoban", "old_he", "zhangfang", "miaozhu")


def speak(game, **fields):
    return act(game, "speak", **fields)


def hall(seed=DRUNK, people=GUESTS, evidence=KICK, **kwargs):
    """The clan called to the hall in the morning, and the manager there with the evidence.

    ``people`` are who is there besides the elder: the errands of the others are taken away, so
    they stay where they are. Everyone trusts the manager at 50."""
    game = talking("zuzhang", seed=seed, hour=9, **kwargs)
    for index in range(len(CAST.index)):
        me(game)["trust"][index] = 50
    me(game)["evidence"].extend(evidence)  # the elder calls the clan for a reason
    assert acks(act(game, "entrust", kind="convene")) == [("applied", None)]
    queue = state_of(game)["tasks"]["queue"]
    queue[:] = [t for t in queue if t["npc"] in (*people, "zuzhang")]
    act(game, "leave")
    for _ in range(600):  # the clan comes, and the hall opens on the hour after
        step(game)
        here = sorted(assembly.audience(state_of(game), "p_clan_hall"))
        if here == sorted([*people, "zuzhang"]) and assembly.meeting_open(me(game), game.tick):
            break
    silence(game)
    return game


def present(game):
    return assembly.audience(state_of(game), "p_clan_hall")


def sure(game, accepting, refusing):
    """Make the first lot believe the truth and the second a falsehood they hold to."""
    truths = [p.id for p in goals_ending.true_conflict_props(state_of(game)["social"]["variant"])]
    for person in accepting:
        for truth in truths:
            believe(game, person, truth, 90, "saw")
    for person in refusing:
        trust(game, person, 0)
        believe(game, person, "pr_liner_damaged", 95, "heard", "zhou_huoji", "zhou_huoji")


def spoke(out):
    (event,) = events(out, "spoke")
    return event


# ------------------------------------------------------------------------------ where and when


def test_the_manager_may_speak_at_the_teahouse_in_the_evening_and_under_either_of_its_names():
    game = talking("cha_laoban", hour=10)
    act(game, "leave")
    me(game)["evidence"].extend(KICK)
    assert acks(speak(game)) == [("rejected", "not_evening")]
    assert not {"speak", "speak_publicly"} & set(step(game)["frame"]["hud"]["verbs"])
    run_to(game, at(1, 17, 30))
    beside(game, "cha_laoban")
    silence(game)
    verbs = step(game)["frame"]["hud"]["verbs"]
    assert {"speak", "speak_publicly"} <= set(verbs)
    out = speak(game)
    assert acks(out) == [("applied", None)] and spoke(out)["venue"] == "p_teahouse"
    late = talking("cha_laoban", hour=17)
    act(late, "leave")
    me(late)["evidence"].extend(KICK)
    assert acks(act(late, "speak_publicly")) == [("applied", None)]  # and the page's name for it


def teahouse(hour, minute, seed=DRUNK):
    """The manager at the teahouse on the first evening, with the kick to show."""
    game = bridge(seed, **CLEAR)
    run_to(game, at(1, hour, minute))
    beside(game, "cha_laoban")
    silence(game)
    me(game)["evidence"].extend(KICK)
    return game


def test_at_tea_time_the_teahouse_holds_eight_named_people_with_granny_li_and_her_eldest_son():
    """Granny Li stays at the teahouse from three until seven, and her eldest son comes at five (the
    schedule of the first evening of the slice), so at a quarter past six they are among the eight.
    """
    game = teahouse(18, 15)
    here = assembly.audience(state_of(game), "p_teahouse")
    assert here == [
        "li_laotai",
        "li_da",
        "zhou_zhanggui",
        "zhou_niangzi",
        "zhou_huoji",
        "cha_laoban",
        "zuzhang",
        "mujiang",
    ]
    sure(game, here, [])
    event = stated(tell(game))
    assert (event["named"], event["accepted"], event["elder"], event["told"]) == (8, 8, 2, True)
    assert "truth_told" in state_of(game)["goals"]["flags"]
    late = teahouse(20, 30)
    assert assembly.audience(state_of(late), "p_teahouse") == ["cha_laoban"]
    sure(late, ["cha_laoban"], [])
    assert acks(tell(late)) == [
        ("rejected", "few_present")
    ]  # one person is no town: nothing is spent
    assert "truth_told" not in state_of(late)["goals"]["flags"]
    assert not assembly.stated_on(state_of(late), 1)
    event = spoke(speak(late))  # what is shown to one is shown, and tells nothing
    assert (event["named"], event["accepted"], event["elder"]) == (1, 1, 0)
    assert event["cleared"] is False and "truth_told" not in state_of(late)["goals"]["flags"]


def test_the_clan_hall_is_closed_to_a_speech_until_the_elder_has_called_the_clan():
    game = talking("zuzhang", hour=9)
    act(game, "leave")
    me(game)["evidence"].extend(KICK)
    out = speak(game)
    assert acks(out) == [("rejected", "no_meeting")]
    assert not {"speak", "speak_publicly"} & set(step(game)["frame"]["hud"]["verbs"])


def test_away_from_both_there_is_nowhere_to_speak_and_in_a_talk_there_is_no_speech():
    game = talking("li_da", hour=10)
    me(game)["evidence"].extend(KICK)
    assert acks(speak(game)) == [("rejected", "talking")]
    act(game, "leave")
    beside(game, "li_da")
    assert acks(speak(game)) == [("rejected", "no_venue")]
    me(game)["busy"] = {"kind": "look", "at": "t_rail", "start": 0, "until": 10**6, "items": []}
    assert acks(speak(game)) == [("rejected", "busy")]


def test_a_room_with_nobody_in_it_hears_nothing_and_a_speech_needs_something_to_show():
    game = talking("zuzhang", hour=9)
    act(game, "leave")
    me(game)["meeting"] = {"tick": game.tick, "until": game.tick + 480, "day": 1, "invited": []}
    state_of(game)["npcs"]["list"][CAST.index["zuzhang"]]["place"] = "p_market"
    me(game)["evidence"].extend(KICK)
    assert acks(speak(game)) == [("rejected", "empty_room")]
    game = hall()
    me(game)["evidence"].clear()
    assert acks(speak(game)) == [("rejected", "no_evidence")]
    assert acks(speak(game, evidence=["e_xiaoman_testimony"])) == [("rejected", "no_evidence")]
    assert acks(speak(game, entry="n4")) == [("rejected", "no_evidence")]


def test_a_malformed_speech_is_an_error():
    game = talking("cha_laoban")
    for fields in ({"kind": "sing"}, {"evidence": "e_x"}, {"evidence": [4]}, {"entry": 3}):
        with pytest.raises(InputError, match="player action speak"):
            speak(game, **fields)


# ------------------------------------------------------------------------------ who accepts


def test_the_manager_shows_the_evidence_and_the_town_is_persuaded_but_told_nothing_by_itself():
    game = hall()
    assert sorted(present(game)) == sorted([*GUESTS, "zuzhang"]) and len(present(game)) == 7
    trusts = {p: trust_of(game, p) for p in present(game)}
    out = speak(game)
    event = spoke(out)
    assert acks(out) == [("applied", None)]
    assert (event["named"], event["accepted"], event["percent"], event["elder"]) == (7, 7, 100, 2)
    assert event["complete"] is True and event["cleared"] is False
    flags = state_of(game)["goals"]["flags"]
    assert not {"elder_accepts", "truth_told"} & set(flags)
    assert "g_truth" not in state_of(game)["goals"]["done"]
    metrics = state_of(game)["goals"]["metrics"]
    assert (metrics["audience_named"], metrics["accept_ratio"]) == (0, 0)
    truth = goals_ending.true_conflict_props("v_drunk")[0].id
    for person in present(game):
        assert stored(game, person, truth) is None  # nobody was told what happened
        assert trust_of(game, person) == trusts[person] + assembly.ACCEPT_TRUST
    assert [len(row) for row in me(game)["public"]["speeches"]] == [assembly.EVIDENCE_ROW]
    assert out["frame"]["bubbles"][-1]["npc"] == "zuzhang"
    plain(game._kernel.state)


def test_the_full_statement_with_the_parts_right_tells_the_truth_to_the_town_that_accepts_it():
    game = hall()
    out = tell(game)
    event = stated(out)
    assert acks(out) == [("applied", None)]
    assert (event["named"], event["accepted"], event["percent"], event["elder"]) == (7, 7, 100, 2)
    assert event["proof"] is True and event["told"] is True and event["wrong"] == []
    flags = state_of(game)["goals"]["flags"]
    assert {"elder_accepts", "truth_told"} <= set(flags) and "g_truth" in state_of(game)["goals"][
        "done"
    ]
    metrics = state_of(game)["goals"]["metrics"]
    assert (metrics["audience_named"], metrics["accept_ratio"]) == (7, 100)
    truth = goals_ending.true_conflict_props("v_drunk")[0].id
    for person in present(game):
        assert stored(game, person, truth).confidence >= 85
    assert out["frame"]["bubbles"][-1]["npc"] == "zuzhang"
    assert [len(row) for row in me(game)["public"]["speeches"]] == [assembly.STATEMENT_ROW]
    plain(game._kernel.state)


@pytest.mark.parametrize(
    ("people", "accepting", "cleared", "why"),
    [
        (("li_laotai", "cha_laoban", "old_he"), 3, False, "four are too few to be the town"),
        (("li_laotai", "cha_laoban", "old_he", "zhangfang"), 3, True, "five, and three are sixty"),
        (("li_laotai", "cha_laoban", "old_he", "zhangfang"), 2, False, "five, and two are forty"),
        (("li_laotai", "cha_laoban", "old_he", "zhangfang"), 5, True, "five, and all of them"),
    ],
)
def test_the_truth_is_cleared_by_five_named_people_and_sixty_in_a_hundred_with_the_elder(
    people, accepting, cleared, why
):
    game = hall(people=people)
    here = sorted(present(game))
    assert len(here) == len(people) + 1
    # who accepts: the elder, then the others in the order of the cast, up to the number we want
    others = [p for p in here if p != "zuzhang"]
    yes = ["zuzhang", *others[: accepting - 1]]
    sure(game, yes, [p for p in here if p not in yes])
    if len(here) < assembly.MIN_NAMED:  # fewer than five is no town to tell, and costs nothing
        assert acks(tell(game)) == [("rejected", "few_present")]
        return
    event = stated(tell(game))
    assert (event["named"], event["accepted"]) == (len(here), accepting), why
    assert event["percent"] == 100 * accepting // len(here)
    assert event["told"] is cleared, why
    assert ("truth_told" in state_of(game)["goals"]["flags"]) is cleared
    assert ("elder_accepts" in state_of(game)["goals"]["flags"]) is cleared


def test_the_truth_is_not_cleared_if_the_elder_does_not_take_it_whatever_the_rest_do():
    game = hall()
    here = present(game)
    sure(game, [p for p in here if p != "zuzhang"], ["zuzhang"])
    event = stated(tell(game))
    assert (event["named"], event["accepted"], event["percent"]) == (7, 6, 85)
    assert event["elder"] == 1 and event["told"] is False and event["wrong"] == []
    flags = state_of(game)["goals"]["flags"]
    assert "elder_accepts" not in flags and "truth_told" not in flags
    assert state_of(game)["goals"]["metrics"]["accept_ratio"] == 85
    assert me(game)["line"][0] == "zuzhang" and me(game)["line"][3] == "elder_no"


def test_a_hall_without_the_elder_in_it_hears_the_manager_and_does_not_clear_the_truth():
    game = hall()
    fill(game)
    # the elder is called away: the tree would send him back on the next tick, and the speech
    # is made before it
    state_of(game)["npcs"]["list"][CAST.index["zuzhang"]]["place"] = "p_temple"
    here = present(game)
    assert "zuzhang" not in here and len(here) == 6
    sure(game, here, [])
    event = stated(state_it(game))
    assert (event["named"], event["accepted"], event["percent"], event["elder"]) == (6, 6, 100, 0)
    assert event["told"] is False and "truth_told" not in state_of(game)["goals"]["flags"]
    assert "elder_accepts" not in state_of(game)["goals"]["flags"]


def test_the_elder_weighs_fifteen_more_than_the_others_but_not_a_proof_that_tells_the_story_apart():
    """What does not tell the story apart the elder weighs at 85 and the others at 70; the whole
    proof, which refutes what he holds, he weighs at the price of anyone."""
    game = hall(people=("li_laotai", "cha_laoban", "old_he"))
    world = state_of(game)
    for person in ("zuzhang", "cha_laoban"):
        believe(game, person, "pr_boat_damaged", 50, "heard", "old_he", "old_he")
        trust(game, person, 40)
    # 80 + 20 - 25 = 75: enough for anyone but the elder, whose price is 85
    assert assembly.accepts(world, "cha_laoban", "v_drunk", 80, [])
    assert not assembly.accepts(world, "zuzhang", "v_drunk", 80, [])
    # he holds the boat at 73, as he does in the story of the flood once the scratches on the boat
    # have gone round, and trusts the manager less: 100 + 12 - 36 = 76 is short of 85 and not of 70
    trust(game, "zuzhang", 24)
    believe(game, "zuzhang", "pr_boat_damaged", 73, "heard", "old_he", "old_he")
    assert not assembly.accepts(world, "zuzhang", "v_drunk", 80, ["pr_boat_damaged"])  # 56
    assert assembly.accepts(world, "zuzhang", "v_drunk", 100, [])
    assert assembly.ELDER_EXTRA == 15 and assembly.ELDER_EASES_AT == 100
    # held at 95 it is not moved by trust that small: 100 + 12 - 47 = 65, and 100 + 20 - 47 = 73
    believe(game, "zuzhang", "pr_boat_damaged", 95, "heard", "old_he", "old_he")
    assert not assembly.accepts(world, "zuzhang", "v_drunk", 100, [])
    trust(game, "zuzhang", 40)
    assert assembly.accepts(world, "zuzhang", "v_drunk", 100, [])


def test_a_full_statement_with_the_whole_proof_is_taken_by_an_elder_who_holds_the_other_account():
    game = hall(people=("li_laotai", "cha_laoban", "old_he", "zhangfang"))
    believe(game, "zuzhang", "pr_boat_damaged", 73, "heard", "old_he", "old_he")
    trust(game, "zuzhang", 24)
    sure(game, [p for p in present(game) if p != "zuzhang"], [])
    event = stated(tell(game))
    assert (event["elder"], event["proof"], event["wrong"], event["told"]) == (2, True, [], True)
    assert "elder_accepts" in state_of(game)["goals"]["flags"]


def test_the_one_the_truth_blames_never_accepts_whatever_he_thinks_of_the_manager():
    people = ("old_he", "li_laotai", "cha_laoban", "miaozhu")
    game = hall(seed=BOAT, evidence=BOAT_SET, people=people)
    assert state_of(game)["social"]["variant"] == "v_boat"
    assert assembly.culprit_of("v_boat") == "old_he" and assembly.culprit_of("v_flood") is None
    for person in present(game):
        trust(game, person, 100)
    sure(game, [p for p in present(game) if p != "old_he"], [])
    event = spoke(speak(game))
    assert (event["named"], event["accepted"]) == (5, 4)
    assert stored(game, "old_he", "pr_boat_damaged").source == "saw"  # and he knows it was him


def test_the_family_of_the_one_the_truth_blames_weighs_it_fifteen_the_harder():
    game = hall(people=("zhou_zhanggui", "li_laotai", "cha_laoban"))
    world = state_of(game)
    assert assembly.culprit_of("v_drunk") == "zhou_dalang"
    for person in ("zhou_zhanggui", "li_laotai"):
        trust(game, person, 20)
        believe(game, person, "pr_liner_damaged", 95, "heard", "zhou_huoji", "zhou_huoji")
    # 100 + 20 // 2 - 95 // 2 = 63, short of 70, for a family that has nothing to do with it
    assert not assembly.accepts(world, "li_laotai", "v_drunk", 100, [])
    for person in ("zhou_zhanggui", "li_laotai"):
        trust(game, person, 60)  # 100 + 30 - 47 = 83
    assert assembly.accepts(world, "li_laotai", "v_drunk", 100, [])
    assert not assembly.accepts(world, "zhou_zhanggui", "v_drunk", 100, [])  # 83 - 15 = 68
    trust(game, "zhou_zhanggui", 70)  # 100 + 35 - 47 - 15 = 73
    assert assembly.accepts(world, "zhou_zhanggui", "v_drunk", 100, [])


def test_what_the_evidence_shows_decides_how_strongly_it_is_taken():
    game = hall(seed=BOAT, evidence=["e_xiaoman_testimony"], people=("li_laotai", "cha_laoban"))
    world = state_of(game)
    person = "cha_laoban"
    trust(game, person, 0)
    believe(game, person, "pr_liner_damaged", 80, "heard", "zhou_huoji", "zhou_huoji")  # 40 held
    for strength, refuted in ((0, []), (40, []), (40, ["pr_liner_damaged"]), (80, ["pr_x"])):
        assert not assembly.accepts(world, person, "v_boat", strength, refuted)
    trust(game, person, 60)  # 30 more
    assert assembly.accepts(world, person, "v_boat", 80, [])  # 80 + 30 - 40 = 70, the price
    assert assembly.accepts(world, person, "v_boat", 40, ["pr_liner_damaged"])  # it refutes hers
    assert not assembly.accepts(world, person, "v_boat", 40, ["pr_boat_scratched"])  # 30
    assert assembly.accepts(world, person, "v_boat", 100, [])  # and the set that tells the story
    # a person who believes the truth and nothing false takes it at once
    believe(game, "li_laotai", "pr_boat_damaged", 60, "saw")
    assert assembly.accepts(world, "li_laotai", "v_boat", 0, [])
    # the elder weighs fifteen more
    believe(game, "zuzhang", "pr_liner_damaged", 80, "heard", "zhou_huoji", "zhou_huoji")
    trust(game, "zuzhang", 60)
    assert assembly.accepts(world, "cha_laoban", "v_boat", 80, [])  # 70
    assert not assembly.accepts(world, "zuzhang", "v_boat", 80, [])  # 70 and the elder wants 85
    assert assembly.accepts(world, "zuzhang", "v_boat", 100, [])


def test_a_person_who_holds_the_truth_without_its_hour_believes_it_already_and_takes_it_at_once():
    game = hall(seed=BOAT, evidence=["e_xiaoman_testimony"], people=("li_laotai", "cha_laoban"))
    world = state_of(game)
    loose = Prop.of("m_loose", "damaged", {"who": "old_he", "what": "t_rail"})  # no hour, no reason
    world["social"]["props"]["m_loose"] = notes.encode_prop(loose)
    trust(game, "cha_laoban", 0)
    believe(game, "cha_laoban", "m_loose", 60, "saw")
    assert assembly.accepts(world, "cha_laoban", "v_boat", 0, [])  # the story, and no other
    believe(game, "cha_laoban", "pr_liner_damaged", 80, "heard", "zhou_huoji", "zhou_huoji")
    assert not assembly.accepts(world, "cha_laoban", "v_boat", 0, [])  # unless a lie as well


def test_the_set_that_tells_the_variant_apart_and_the_props_it_refutes():
    assert assembly.complete("v_boat", BOAT_SET) and assembly.complete("v_boat", [*BOAT_SET, "x"])
    assert assembly.complete("v_boat", ["e_gengfu_boat", "e_boat_scratches"])
    assert not assembly.complete("v_boat", ["e_xiaoman_testimony"])
    assert not assembly.complete("v_flood", BOAT_SET) and assembly.complete("v_drunk", KICK)
    refuted = assembly.refuted("v_drunk", KICK, True)
    assert {"pr_liner_damaged", "pr_li_damaged", "pr_li_damaged_on_purpose"} <= set(refuted)
    assert "pr_li_damaged_jealous" in refuted and "pr_dalang_damaged" not in refuted
    # one piece refutes what it says it does, and the retellings of that
    only = assembly.refuted("v_boat", ["e_huoji_testimony"], False)
    assert (
        only
        == sorted(
            [
                "pr_liner_damaged",
                "pr_liner_damaged_on_purpose",
                "pr_liner_damaged_jealous",
                "pr_li_damaged",
                "pr_li_damaged_on_purpose",
                "pr_li_damaged_jealous",
            ]
        )
        and assembly.refuted("v_boat", ["e_boat_scratches"], False) == []
    )


def test_an_entry_of_the_notebook_stands_for_the_evidence_that_backs_it():
    game = hall(evidence=["e_footprint"])  # (the elder wants some proof before he calls the clan)
    section = me(game)
    section["evidence"].append("e_gengfu_dalang")
    entry, _ = notebook.add_seen(section, "pr_dalang_at_bridge", 0)
    body = {"evidence": [], "entry": entry["id"]}
    assert assembly.presented(section, body) == ["e_gengfu_dalang", "e_footprint"]
    assert assembly.presented(section, {"evidence": ["e_footprint", "nothing"], "entry": ""}) == [
        "e_footprint"
    ]
    assert assembly.presented(section, {"evidence": [], "entry": ""}) == section["evidence"]


# ------------------------------------------------------------------------------ what it does


def test_a_town_that_accepts_trusts_the_manager_more_and_the_heads_hold_less_against_each_other():
    game = hall()
    heads = ("li_laotai", "zhou_zhanggui")
    before = {h: bonds.value(state_of(game)["social"], LO, h, other, bonds.GRUDGE)
              for h, other in zip(heads, reversed(heads), strict=True)}  # fmt: skip
    trusts = {p: trust_of(game, p) for p in present(game)}
    tell(game)
    for person in present(game):
        assert trust_of(game, person) == trusts[person] + assembly.ACCEPT_TRUST
    for head, other in zip(heads, reversed(heads), strict=True):
        now = bonds.value(state_of(game)["social"], LO, head, other, bonds.GRUDGE)
        assert now == max(0, before[head] - assembly.GRUDGE_DROP)


def test_the_props_the_evidence_refutes_are_refuted_in_public_only_if_enough_people_took_it():
    game = hall()
    here = present(game)
    sure(game, [here[0]], here[1:])  # one of seven
    event = spoke(speak(game))
    assert event["accepted"] == 1 and me(game)["public"]["refuted"] == []
    game = hall()
    out = speak(game)
    refuted = me(game)["public"]["refuted"]
    assert spoke(out)["accepted"] == 7 and {"pr_li_damaged", "pr_li_damaged_jealous"} <= set(
        refuted
    )
    assert persuade.open_way(state_of(game), "hc_li_bamboo") == "hc_rumor_cleared"


def test_the_same_speech_again_to_the_same_people_on_the_same_day_is_not_made_twice():
    game = hall()
    assert acks(speak(game)) == [("applied", None)]
    before = [trust_of(game, p) for p in CAST.index]
    assert acks(speak(game)) == [("rejected", "said_already")]
    assert [trust_of(game, p) for p in CAST.index] == before
    me(game)["evidence"].append("e_footprint")  # something more to show
    assert acks(speak(game)) == [("applied", None)]


def test_the_speech_of_the_hall_opens_the_way_to_the_bamboo():
    game = hall()
    speak(game)
    state_of(game)["tasks"]["queue"].clear()  # the clan is free to go about its day
    step(game)
    beside(game, "li_laotai")
    silence(game)
    assert acks(act(game, "talk", npc="li_laotai")) == [("applied", None)]
    out = act(game, "entrust", kind="lend")
    assert acks(out) == [("applied", None)]
    assert events(out, "entrusted")[0]["way"] == "hc_rumor_cleared"


def test_the_offers_of_the_page_are_the_evidence_held_and_the_table():
    game = hall()
    me(game)["evidence"].append("e_footprint")
    offers = step(game)["frame"]["player"]["offers"]
    assert [o["id"] for o in offers["speak"]] == [
        "all",
        "item:e_gengfu_dalang",
        "item:e_footprint",
        "statement",
        "meal",
    ]
    assert offers["speak"][0]["body"] == {"kind": "evidence"}
    assert offers["speak"][3]["body"] == {"kind": "statement"}
    assert offers["speak"][4]["body"] == {"kind": "meal"}
    # each piece of evidence is shown by its name, and the table is the same in both languages
    labels = {o["id"]: o["label"] for o in offers["speak"]}
    assert labels["item:e_footprint"] == {
        "zh": "拿出「断栏边带酒气的鞋印」",
        "en": "Show: A shoeprint smelling of wine by the broken railing",
    }
    assert labels["item:e_gengfu_dalang"]["en"] == (
        "Show: The night watchman's word: Zhou Dalang, drunk, walked onto the bridge"
    )
    assert labels["meal"] == {"zh": "摆一桌和解饭", "en": "Lay a table for peace"}
    assert offers["tell"] == [] and offers["entrust"] == [] and offers["promise"] == []
    one = offers["speak"][1]
    out = speak(game, **one["body"])
    assert acks(out) == [("applied", None)] and spoke(out)["complete"] is True


# ------------------------------------------------------------------------------ the table


def test_the_two_family_heads_sit_down_with_witnesses_and_a_peace_is_seen():
    game = hall()
    grudges = lambda: [  # noqa: E731
        bonds.value(state_of(game)["social"], LO, a, b, bonds.GRUDGE)
        for a, b in (("li_laotai", "zhou_zhanggui"), ("zhou_zhanggui", "li_laotai"))
    ]
    before = grudges()
    trusts = {p: trust_of(game, p) for p in present(game)}
    out = speak(game, kind="meal")
    assert acks(out) == [("applied", None)] and events(out, "feast")[0]["named"] == 7
    assert "reconcile_seen" in state_of(game)["goals"]["flags"]
    assert grudges() == [max(0, g - assembly.MEAL_DROP) for g in before]
    for person in present(game):
        assert trust_of(game, person) == trusts[person] + assembly.MEAL_TRUST
    assert acks(speak(game, kind="meal")) == [("rejected", "said_already")]


def grudge(game, a, b):
    return bonds.value(state_of(game)["social"], LO, a, b, bonds.GRUDGE)


def test_the_table_after_the_truth_was_told_does_more_than_the_table_before_it():
    heads = [("li_laotai", "zhou_zhanggui"), ("zhou_zhanggui", "li_laotai")]
    game = hall()
    before = [grudge(game, a, b) for a, b in heads]
    speak(game, kind="meal")
    assert [grudge(game, a, b) for a, b in heads] == [
        max(0, g - assembly.MEAL_DROP) for g in before
    ]
    game = hall()
    tell(game)  # both heads take the truth in: ten less each
    middle = [grudge(game, a, b) for a, b in heads]
    assert middle == [max(0, g - assembly.GRUDGE_DROP) for g in before]
    speak(game, kind="meal")
    assert [grudge(game, a, b) for a, b in heads] == [
        max(0, g - assembly.MEAL_DROP_AFTER_TRUTH) for g in middle
    ]


def test_a_table_needs_both_heads_and_three_others():
    game = hall(people=("cha_laoban", "old_he", "zhangfang"))
    assert "zhou_zhanggui" not in present(game)
    assert acks(speak(game, kind="meal")) == [("rejected", "heads_absent")]
    game = hall(people=("li_laotai", "zhou_zhanggui"))
    assert len(present(game)) == 3
    assert acks(speak(game, kind="meal")) == [("rejected", "few_present")]
    game = hall(people=("li_laotai", "zhou_zhanggui", "cha_laoban", "old_he"))
    assert acks(speak(game, kind="meal")) == [("applied", None)]  # the elder and two more besides


def test_peace_needs_the_grudge_below_thirty_as_well_as_the_table():
    game = hall()
    speak(game, kind="meal")
    step(game)
    flags = state_of(game)["goals"]["flags"]
    assert state_of(game)["goals"]["metrics"]["grudge"] >= 30 and "reconcile_seen" in flags
    assert "reconciled" not in flags  # a table was seen, and the grudge is still too great
    game = hall()
    tell(game)
    speak(game, kind="meal")
    step(game)
    assert state_of(game)["goals"]["metrics"]["grudge"] < 30
    assert {"reconcile_seen", "reconciled"} <= set(state_of(game)["goals"]["flags"])
