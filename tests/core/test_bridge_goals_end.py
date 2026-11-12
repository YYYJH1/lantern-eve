"""The truth and the peace, the last night with its ending and reveal, the turnout and the frame."""

import itertools
import json

import pytest
from bridge_helpers import CAST, at, world_of
from goals_helpers import (
    DEV,
    HELPERS,
    LAST_NIGHT,
    Hand,
    body,
    dev,
    hand,
    join_all,
    rally,
    sim_of,
)

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.cognition.beliefs import Belief, BeliefStore
from lantern_core.cognition.lines import capitalise
from lantern_core.cognition.props import Prop
from lantern_core.inputs import InputError
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import (
    bonds,
    crowd,
    goals,
    goals_call,
    goals_ending,
    goals_rules,
    lore,
    notebook,
    notes,
    player,
    retell,
    social,
    weather,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.sentences import SENTENCES
from lantern_core.world.bridge.world import FRAME_KEYS

INPUTS = goals_rules.rules().inputs


@pytest.fixture(scope="module")
def eve():
    """The snapshot of a quiet game with a clear sky, on the eve of the last night."""
    h = hand(3)
    h.run_to(LAST_NIGHT)
    return h.game.snapshot_json()


def at_the_end(eve, mutate=None, *actions):
    """The last night of the game in the snapshot, after ``mutate(hand)`` set up a case, with the
    player ``actions`` sent in the call that holds the ending.

    Returns the hand and the outputs of that call."""
    h = Hand(Game.from_snapshot_json(eve))
    if mutate is not None:
        mutate(h)
    return h, h.send(*actions)


def ending_of(out):
    found = [e for e in out["events"] if e["kind"] == "ending"]
    assert len(found) == 1
    return found[0]


def put_beliefs(h, holders, prop_id, confidence=70):
    """Make ``holders`` and nobody else believe a prop about the conflict."""
    section = h.state["social"]
    book = social.book(section)
    for person in lore.lore().people:
        for pid in sorted(section["beliefs"][person]):
            if goals_ending.about_the_conflict(book[pid]):
                del section["beliefs"][person][pid]
    for person in holders:
        belief = Belief(person, prop_id, "assert", confidence, "inferred", None, None, 0, 0, None)
        notes.hold(section, belief)


def lie_and_truth(h):
    """A prop about the conflict that is false in every variant, and one that is true in this."""
    variant = h.state["social"]["variant"]
    (true,) = goals_ending.true_conflict_props(variant)
    return "pr_liner_damaged", true.id


# ------------------------------------------------------------------------------ the truth


def test_the_truth_told_in_public_raises_its_flag_once_and_marks_the_goal():
    h = hand(3)
    out = h.send(dev("truth"))
    assert h.acks(out) == [("applied", None)]
    assert h.goals["flags"]["truth_told"] == 0 and h.goals["done"]["g_truth"] == 0
    assert [e["flag"] for e in out["events"] if e["kind"] == "flag"] == ["truth_told"]
    assert [e["goal"] for e in out["events"] if e["kind"] == "goal"] == ["g_truth"]
    assert h.acks(h.send(dev("truth"))) == [("rejected", "no_change")]
    assert goals.flag_up(h.state, "truth_told") and not goals.flag_up(h.state, "reconciled")


def test_the_parts_of_the_goal_g_truth_come_in_through_metrics_and_flags():
    h = hand(3)
    h.run_to(10)
    sim = sim_of(h)
    steps = [
        lambda: goals.set_metric(sim, "audience_named", 5),
        lambda: goals.set_metric(sim, "accept_ratio", 59),
        lambda: goals.set_flag(sim, "elder_accepts"),
    ]
    for step in steps:
        assert step()
        h.send()
        assert "truth_told" not in h.goals["flags"]  # the ratio is a point short
    assert goals.set_metric(sim, "accept_ratio", 60)
    h.send()
    assert "truth_told" in h.goals["flags"] and "g_truth" in h.goals["done"]
    # the audience must be five at the least
    other = hand(3)
    other.run_to(10)
    sim = sim_of(other)
    goals.set_metric(sim, "audience_named", 4)
    goals.set_metric(sim, "accept_ratio", 100)
    goals.set_flag(sim, "elder_accepts")
    other.send()
    assert "truth_told" not in other.goals["flags"]


def test_what_cannot_be_set_is_refused():
    h = hand(3)
    h.run_to(5)
    sim = sim_of(h)
    assert goals.set_flag(sim, "elder_accepts") is True
    assert goals.set_flag(sim, "elder_accepts") is False  # up already
    assert goals.set_flag(sim, "no_such_flag") is False
    for derived in ("bridge_fixed", "detour_done", "reconciled", "lane_opened", "bamboo_delivered"):
        assert goals.set_flag(sim, derived) is False  # these follow from the state of the town
    assert "bridge_fixed" not in h.goals["flags"]
    assert goals.set_metric(sim, "no_such_metric", 3) is False
    assert goals.set_metric(sim, "accept_ratio", 1.5) is False  # type: ignore[arg-type]
    assert goals.set_metric(sim, "accept_ratio", 500) and h.goals["metrics"]["accept_ratio"] == 100
    assert goals.set_metric(sim, "accept_ratio", -4) and h.goals["metrics"]["accept_ratio"] == 0


def test_the_truth_cannot_be_told_after_its_deadline():
    h = hand(3)
    h.run_to(goals_rules.rules().goals[4].deadline)
    assert h.acks(h.send(dev("truth"))) == [("applied", None)]  # on the last tick it can be
    late = hand(3)
    late.run_to(goals_rules.rules().goals[4].deadline + 1)
    assert late.acks(late.send(dev("truth"))) == [("rejected", "no_change")]
    sim = sim_of(late)
    goals.set_metric(sim, "audience_named", 9)
    goals.set_metric(sim, "accept_ratio", 90)
    goals.set_flag(sim, "elder_accepts")
    late.send()
    assert "truth_told" not in late.goals["flags"] and "g_truth" not in late.goals["done"]


# ------------------------------------------------------------------------------ the peace


def grudge_of(h):
    return h.goals["metrics"]["grudge"]


def test_the_grudge_is_the_larger_of_what_the_two_family_heads_hold():
    h = hand(3)
    h.run_to(2)
    section, lore_ = h.state["social"], lore.lore()
    first, second = goals_call.HEADS
    a = bonds.value(section, lore_, first, second, bonds.GRUDGE)
    b = bonds.value(section, lore_, second, first, bonds.GRUDGE)
    assert a >= 30 and b >= 30
    assert grudge_of(h) == max(a, b)
    bonds.nudge(section, lore_, first, second, bonds.GRUDGE, -10)
    h.send()
    assert grudge_of(h) == max(bonds.value(section, lore_, first, second, bonds.GRUDGE), b)


def test_the_families_are_reconciled_when_a_reconciliation_was_seen_and_the_grudge_is_low():
    h = hand(3)
    h.run_to(5)
    assert h.acks(h.send(dev("reconcile"))) == [("applied", None)]
    assert "reconcile_seen" in h.goals["flags"] and "reconciled" not in h.goals["flags"]
    assert h.acks(h.send(dev("reconcile"))) == [("rejected", "no_change")]
    h.send(dev("grudge", value=30))  # not below 30
    assert grudge_of(h) == 30 and "reconciled" not in h.goals["flags"]
    out = h.send(dev("grudge", value=29))
    assert grudge_of(h) == 29
    assert h.goals["flags"]["reconciled"] == out["tick"]
    assert "g_reconcile" in h.goals["done"]
    h.send(dev("grudge", value=90))  # peace is not taken back
    assert "reconciled" in h.goals["flags"]


def test_a_low_grudge_without_a_reconciliation_seen_is_not_peace_yet_and_peace_follows_it():
    h = hand(3)
    h.run_to(5)
    h.send(dev("grudge", value=0))
    h.run_to(300)
    assert "reconciled" not in h.goals["flags"]
    out = h.send(dev("reconcile"))
    assert h.goals["flags"]["reconciled"] == out["tick"]


def test_peace_needs_the_grudge_low_in_both_directions():
    h = hand(3)
    h.run_to(5)
    section, lore_ = h.state["social"], lore.lore()
    first, second = goals_call.HEADS
    h.send(dev("reconcile"))
    row = section["bonds"][first]
    row[4 * lore_.index[second] + bonds.GRUDGE] = 5  # one head forgives
    h.send()
    assert "reconciled" not in h.goals["flags"] and grudge_of(h) >= 30
    section["bonds"][second][4 * lore_.index[first] + bonds.GRUDGE] = 5
    h.send()
    assert "reconciled" in h.goals["flags"] and grudge_of(h) == 5


# ------------------------------------------------------------------------------ the ending


@pytest.mark.parametrize("bits", list(itertools.product([False, True], repeat=4)))
def test_the_last_night_gives_the_ending_the_table_names_for_the_four_flags(eve, bits):
    def raise_flags(h):
        for name, up in zip(INPUTS, bits, strict=True):
            if up:
                h.goals["flags"][name] = 7

    h, out = at_the_end(eve, raise_flags)
    event = ending_of(out)
    bridge, detour, truth, peace = bits
    expected = (
        "ending_split"
        if not (bridge or detour)
        else "ending_full"
        if bridge and truth and peace
        else "ending_barely"
    )
    assert event["tick"] == LAST_NIGHT and event["ending"] == expected
    assert event["inputs"] == dict(zip(INPUTS, bits, strict=True))
    row = next(r for r in goals_rules.rules().rows if r.id == expected)
    assert event["label"] == {"zh": row.label, "en": goals_ending.LABELS_EN[expected]}
    assert event["passage"] == ("mended" if bridge else "detour" if detour else "none")
    assert h.goals["ending"]["id"] == expected and h.goals["ending"]["tick"] == LAST_NIGHT
    assert out["frame"]["hud"]["ending"] == expected
    assert event["hidden"] == [] or event["hidden"][0]["id"] == "hidden_legend_of_lie"


def test_there_is_no_full_ending_without_the_bridge_whatever_else_is_done(eve):
    def all_but_the_bridge(h):
        for name in ("detour_done", "truth_told", "reconciled"):
            h.goals["flags"][name] = 7

    _, out = at_the_end(eve, all_but_the_bridge)
    assert ending_of(out)["ending"] == "ending_barely"


def test_the_hidden_ending_comes_when_more_than_half_of_the_named_believe_a_lie(eve):
    results = {}
    for liars in (0, 10, 11, 20):

        def believe(h, liars=liars):
            lie, _ = lie_and_truth(h)
            put_beliefs(h, lore.lore().people[:liars], lie)

        _, out = at_the_end(eve, believe)
        event = ending_of(out)
        results[liars] = [r["id"] for r in event["hidden"]]
        assert event["ending"] == "ending_split"  # it is laid over the base ending
    assert results == {
        0: [],
        10: [],  # half is not more than half
        11: ["hidden_legend_of_lie"],
        20: ["hidden_legend_of_lie"],
    }
    h, out = at_the_end(eve, lambda h: put_beliefs(h, lore.lore().people[:11], "pr_liner_damaged"))
    assert h.goals["metrics"]["false_belief_share"] == 55
    assert h.goals["ending"]["hidden"] == ["hidden_legend_of_lie"]
    label = ending_of(out)["hidden"][0]["label"]
    assert label == {"zh": "谎话成了传说", "en": "The lie became a legend"}


def test_a_belief_in_the_truth_or_a_weak_one_in_a_lie_is_not_a_belief_in_a_lie(eve):
    def believe_the_truth(h):
        _, truth = lie_and_truth(h)
        put_beliefs(h, lore.lore().people, truth, 90)

    h, _ = at_the_end(eve, believe_the_truth)
    assert h.goals["metrics"]["false_belief_share"] == 0

    def doubt_a_lie(h):
        lie, _ = lie_and_truth(h)
        put_beliefs(h, lore.lore().people, lie, goals_ending.BELIEVE_AT - 1)

    h, _ = at_the_end(eve, doubt_a_lie)
    assert h.goals["metrics"]["false_belief_share"] == 0

    def believe_a_lie(h):
        lie, _ = lie_and_truth(h)
        put_beliefs(h, lore.lore().people, lie, goals_ending.BELIEVE_AT)

    h, _ = at_the_end(eve, believe_a_lie)
    assert h.goals["metrics"]["false_belief_share"] == 100


def test_a_statement_made_on_the_way_is_judged_by_what_it_says(eve):
    def made_up(h):
        section = h.state["social"]
        variant = section["variant"]
        (true,) = goals_ending.true_conflict_props(variant)
        same = Prop.of("m_same", true.pred, true.args_dict(), true.span, true.neg, true.motive)
        other = Prop.of("m_lie", "damaged", {"who": "li_er", "what": "t_rail"}, (-45, -35))
        section["props"]["m_same"] = notes.encode_prop(same)
        section["props"]["m_lie"] = notes.encode_prop(other)
        put_beliefs(h, (), "pr_liner_damaged")
        for person, prop in (("li_da", "m_same"), ("li_er", "m_lie")):
            notes.hold(
                section, Belief(person, prop, "assert", 80, "inferred", None, None, 0, 0, None)
            )

    h, _ = at_the_end(eve, made_up)
    assert goals_ending.believers(h.state)["false"] == ["li_er"]
    assert "li_da" in goals_ending.believers(h.state)["true"]


def retellings_of(truth, speaker="li_da"):
    """Each thing a townsperson can make of the true prop ``truth`` by an operator of ``retell``,
    as the props the game would write."""
    lo = lore.lore()
    told = "cha_laoban"
    belief = Belief(speaker, truth.id, "assert", 80, "heard", told, told, 1, 0, "c0")
    found = retell.changes(
        lo,
        notes.PropView({}, lo.book.props),
        truth,
        belief,
        BeliefStore(speaker, [belief]),
        suspicion=lo.traits[speaker]["suspicion"],
        relation=lambda kind, holder, target: True,
    )
    return {change.op: retell.settle(lo, {}, change.prop) for change in found}


@pytest.mark.parametrize("variant", sorted(lore.lore().variants))
def test_a_retelling_of_the_truth_that_leaves_out_when_or_why_is_still_the_truth(variant):
    truths = goals_ending.true_conflict_props(variant)
    (truth,) = truths
    made = retellings_of(truth)
    assert "level" in made  # what the town does most: it drops the hour or the reason
    for op, prop in made.items():
        assert prop.id not in lore.lore().book.props and prop.parent == truth.id
        assert goals_ending.is_true(prop, truths), (op, prop)
    bare = Prop.of("m_bare", truth.pred, truth.args_dict())  # no hour, no reason
    assert bare.span is None and bare.motive is None
    assert goals_ending.is_true(bare, truths)
    late = Prop.of("m_late", truth.pred, truth.args_dict(), (300, 360), False, "spite")
    assert goals_ending.is_true(late, truths)  # an hour and a reason that are not the truth's


def test_a_town_that_retells_the_truth_loosely_believes_no_falsehood(eve):
    def retold(h):
        section = h.state["social"]
        (truth,) = goals_ending.true_conflict_props(section["variant"])
        loose = Prop.of("m_loose", truth.pred, truth.args_dict())
        section["props"]["m_loose"] = notes.encode_prop(loose)
        put_beliefs(h, (), "pr_liner_damaged")
        for person in lore.lore().people:
            belief = Belief(person, "m_loose", "assert", 80, "inferred", None, None, 0, 0, None)
            notes.hold(section, belief)

    h, out = at_the_end(eve, retold)
    assert h.goals["metrics"]["false_belief_share"] == 0
    assert ending_of(out)["hidden"] == []
    assert goals_ending.believers(h.state)["true"] == list(lore.lore().people)


@pytest.mark.parametrize("variant", sorted(lore.lore().variants))
def test_the_story_is_the_predicate_and_the_people_and_not_the_hour(variant):
    truths = goals_ending.true_conflict_props(variant)
    (truth,) = truths
    others = [
        Prop.of(f"m_{who}", "damaged", {"who": who, "what": "t_rail"})
        for who in ("li_er", "fam_li", "old_he", "zhou_dalang", "fam_zhou")
    ]
    others.append(Prop.of("m_flood", "flood_damaged", {"what": "t_rail"}))
    for prop in others:
        same = prop.pred == truth.pred and (
            prop.args_dict() == truth.args_dict()
            # a family stands for its members
            or (prop.arg("who") == "fam_zhou" and truth.arg("who") == "zhou_dalang")
        )
        assert goals_ending.is_true(prop, truths) == same, (variant, prop.id)
        # giving it the hour and the reason of the truth does not make it the truth
        timed = Prop.of(prop.id, prop.pred, prop.args_dict(), truth.span, False, truth.motive)
        assert goals_ending.is_true(timed, truths) == same, (variant, prop.id)


# ------------------------------------------------------------------------------ the reveal


def test_the_reveal_holds_the_truth_the_chains_that_reached_anyone_and_who_believes_what(eve):
    h, out = at_the_end(eve)
    reveal = ending_of(out)["reveal"]
    assert reveal == h.goals["ending"]["reveal"]
    assert canon.loads(canon.dumps_str(reveal)) == reveal  # plain data, ints only
    section = h.state["social"]
    variant = lore.lore().variants[section["variant"]]
    assert reveal["truth"] == {
        "variant": variant.id,
        "label": goals_ending.truth_label(variant.id),
        "props": [p.id for p in goals_ending.true_conflict_props(variant.id)],
    }
    assert reveal["told"] == {
        "total": section["counts"]["told"],
        "mutated": section["counts"]["mutated"],
    }
    sides = reveal["believers"]
    assert sorted(sides["false"] + sides["true"] + sides["none"]) == sorted(CAST.index)
    assert sides == goals_ending.believers(h.state)
    (chain,) = reveal["chains"]  # the one rumour of the script, which reached people
    assert chain["id"] == "ch_li_er_rumor"
    props = [hop["prop"] for hop in SCRIPT["chains"][0]["hops"]]
    assert [hop[0] for hop in chain["planted"]] == props
    assert [pid for pid, _ in chain["held"]] == props
    claims = social.claims(section)
    assert [row[0] for row in chain["told"]] == [c for c in claims if claims[c].prop in props]
    for cid, speaker, listener, prop, op, tick in chain["told"]:
        claim = claims[cid]
        assert (claim.speaker, claim.listeners[0], claim.prop, claim.op or "", claim.tick) == (
            speaker,
            listener,
            prop,
            op,
            tick,
        )
    for pid, holders in chain["held"]:
        for person, confidence, teller, hop in holders:
            belief = social.stores(section)[person].get(pid)
            assert (belief.confidence, belief.teller or "", belief.hop) == (confidence, teller, hop)
            assert confidence > 0
    reached = {person for pid, holders in chain["held"][1:] for person, *_ in holders}
    assert set(chain["reached"]) == reached and reached
    assert chain["true"] == [pid for pid in props if lore.lore().book.holds(variant.id, pid)]
    assert "player" not in reveal or isinstance(reveal["player"], dict)


def labels_in(data):
    """Every value under a key ``label``, at any depth of plain data."""
    if isinstance(data, dict):
        for key, value in data.items():
            if key == "label":
                yield value
            yield from labels_in(value)
    elif isinstance(data, list):
        for value in data:
            yield from labels_in(value)


def is_han(char):
    return "\u4e00" <= char <= "\u9fff"


def said(prop):
    """A prop said by the table of lines, built here from the names of the entities."""
    lo = lore.lore()
    return lo.lines.statement(prop, lo.names)


def test_every_label_of_the_reveal_is_said_in_both_languages(eve):
    _, out = at_the_end(eve)
    reveal = ending_of(out)["reveal"]
    found = list(labels_in(reveal))
    assert len(found) == 1 + len(reveal["chains"]) >= 2  # the truth, and each chain
    for label in found:
        assert set(label) == {"zh", "en"}
        assert label["zh"] and label["en"] and label["zh"] != label["en"]
        assert any(is_han(char) for char in label["zh"])  # Chinese in the Chinese
        assert not any(is_han(char) for char in label["en"])  # and none in the English


@pytest.mark.parametrize("variant", sorted(lore.lore().variants))
def test_the_truth_is_said_from_the_true_props_of_the_variant_and_not_written_for_it(variant):
    lo = lore.lore()
    true = goals_ending.true_conflict_props(variant)
    assert len(true) >= 1
    label = goals_ending.truth_label(variant)
    for prop in true:
        statement = said(prop)
        assert statement["zh"] in label["zh"]
        assert capitalise(statement["en"]) in label["en"]
    assert label["zh"].endswith("。") and label["en"].endswith(".")
    names = {  # the entities the true props are about, as the table of lines names them
        entity for prop in true for _, entity in prop.args if entity in lo.names
    }
    assert names
    forms = SENTENCES["forms"]  # a place or a thing with a form of its own is said by it
    for entity in names:
        name = forms.get(entity, lo.names[entity])
        assert name["zh"] in label["zh"]
        assert name["en"].removeprefix("the ").lower() in label["en"].lower()
    # a label that is not the script's own words, which say less than the props do
    assert label["zh"] != lo.variants[variant].label


def test_the_three_truths_are_told_differently_in_each_language():
    labels = [goals_ending.truth_label(v) for v in sorted(lore.lore().variants)]
    assert len({label["zh"] for label in labels}) == len({label["en"] for label in labels}) == 3


def test_a_variant_with_nothing_true_about_the_conflict_has_the_scripts_words_and_no_english(
    monkeypatch,
):
    monkeypatch.setattr(goals_ending, "true_conflict_props", lambda variant_id: [])
    label = goals_ending.truth_label("v_boat")
    assert label == {"zh": lore.lore().variants["v_boat"].label, "en": ""}


def test_the_label_of_a_chain_sets_its_first_version_against_its_last():
    lo = lore.lore()
    for chain in SCRIPT["chains"]:
        props = [hop["prop"] for hop in chain["hops"]]
        first, last = said(lo.book.props[props[0]]), said(lo.book.props[props[-1]])
        label = goals_ending.chain_label(props)
        assert label["zh"] == f"从「{first['zh']}」传成「{last['zh']}」"
        assert label["en"] == f"From “{capitalise(first['en'])}” to “{capitalise(last['en'])}”"
        single = goals_ending.chain_label(props[:1])  # a chain of one hop is its first version
        assert single == {"zh": first["zh"], "en": capitalise(first["en"])}


def test_every_version_along_a_chain_is_said_in_both_languages(eve):
    h, out = at_the_end(eve)
    (chain,) = ending_of(out)["reveal"]["chains"]
    book = lore.lore().book.props
    props = [row[0] for row in chain["planted"]]
    assert set(chain["texts"]) == set(props) and len(props) == 6
    for pid in props:
        text = chain["texts"][pid]
        assert text == notebook.sentence(book[pid])  # the sentence of the notebook, the same words
        assert set(text) == {"zh", "en"} and text["zh"].endswith("。") and text["en"].endswith(".")
    assert "李二" in chain["texts"]["pr_liner_looking"]["zh"]
    assert "Li Er" in chain["texts"]["pr_liner_looking"]["en"]
    assert chain["texts"]["pr_li_damaged_on_purpose"]["en"].endswith("on purpose.")
    assert len({chain["texts"][pid]["zh"] for pid in props}) == len(props)  # six different words
    # whatever a row of the chain refers to, the page can say
    assert {row[3] for row in chain["told"]} <= set(chain["texts"])
    assert {pid for pid, _ in chain["held"]} <= set(chain["texts"])
    assert canon.loads(canon.dumps_str(chain)) == chain


def test_a_chain_that_reached_nobody_is_left_out_of_the_reveal(eve):
    def forget(h):
        section = h.state["social"]
        for person in section["beliefs"]:
            for pid in ("pr_liner_at_bridge", "pr_liner_damaged", "pr_li_damaged"):
                section["beliefs"][person].pop(pid, None)
            for pid in ("pr_li_damaged_on_purpose", "pr_li_damaged_jealous"):
                section["beliefs"][person].pop(pid, None)

    _, out = at_the_end(eve, forget)
    assert ending_of(out)["reveal"]["chains"] == []


def test_a_module_can_add_its_own_part_to_the_reveal(eve, monkeypatch):
    monkeypatch.setattr(player, "ending_reveal", lambda ws: {"words": 3}, raising=False)
    monkeypatch.setattr(social, "ending_reveal", lambda ws: {"about_you": []}, raising=False)
    _, out = at_the_end(eve)
    reveal = ending_of(out)["reveal"]
    assert reveal["player"] == {"words": 3} and reveal["social"] == {"about_you": []}


# ------------------------------------------------------------------------------ the ending stays


EVENT_KEYS = {
    "kind",
    "tick",
    "ending",
    "label",
    "hidden",
    "inputs",
    "passage",
    "promised",
    "turnout",
    "festival",
    "reveal",
    "epilogue",
}


def test_the_event_keeps_its_keys_and_the_frame_of_that_call_carries_the_same_object(eve):
    h, out = at_the_end(eve)
    event = ending_of(out)
    assert set(event) == EVENT_KEYS and event["tick"] == LAST_NIGHT and event["kind"] == "ending"
    # kind and tick too, so that a page reads the key of the frame as it reads the event
    assert out["frame"]["ending"] == event
    assert out["frame"]["hud"]["ending"] == event["ending"]  # the id on the hud stays
    done = h.goals["ending"]
    assert event["reveal"] == done["reveal"] and event["inputs"] == done["inputs"]
    assert event["label"] == {
        "zh": "两家各点各的灯",
        "en": "Each family lights its own lamps",
    }


def test_a_frame_before_the_last_night_has_the_key_with_nothing_in_it():
    h = hand(3)
    for _ in range(80):
        out = h.send()
        assert "ending" in out["frame"] and out["frame"]["ending"] is None
    h.run_to(LAST_NIGHT - 1)
    assert h.frame["ending"] is None and h.frame["hud"]["ending"] == ""


def compact_of(event):
    """The ending as the frames after the call that made it carry it: the event, no reveal and no
    epilogue."""
    return {key: value for key, value in event.items() if key not in ("reveal", "epilogue")}


def test_every_frame_after_the_ending_carries_the_compact_form_and_the_game_has_the_whole(eve):
    h, out = at_the_end(eve)
    event = ending_of(out)
    compact = compact_of(event)
    assert set(compact) == EVENT_KEYS - {"reveal", "epilogue"}
    for _ in range(400):  # the night, and on into the dawn of a sixth day
        frame = h.send()["frame"]
        assert frame["ending"] == compact
        assert canon.dumps_str(canon.loads(json.dumps(frame))) == canon.dumps_str(frame)
        assert json.loads(h.game.ending_json()) == event  # a host asks for it whenever it needs it
    assert len(h.kinds("ending")) == 1  # the event came once
    assert len(json.dumps(compact)) * 5 < len(json.dumps(event))  # and the frame is lighter for it


def test_the_frame_has_the_whole_ending_on_the_tick_it_happens_and_the_compact_one_after(eve):
    h, out = at_the_end(eve)
    event = ending_of(out)
    assert out["advanced"] and out["frame"]["ending"] == event
    # a call that only pauses simulates nothing, so it stands on the same tick with the same state
    seq = h.game.next_seq
    paused = json.loads(h.game.step(json.dumps([{"seq": seq, "kind": "pause", "body": {}}])))
    assert not paused["advanced"] and paused["frame"]["ending"] == event
    resumed = json.loads(h.game.step(json.dumps([{"seq": seq + 1, "kind": "resume", "body": {}}])))
    assert resumed["advanced"] and resumed["frame"]["ending"] == compact_of(event)
    # a game restored right after the ending is the same game and gives the same frames
    twin = Hand(Game.from_snapshot_json(eve))
    assert twin.send()["frame"]["ending"] == event
    assert twin.send()["frame"]["ending"] == compact_of(event)


def test_the_game_has_the_whole_ending_at_any_time_and_none_before_the_last_night():
    h = hand(3)
    assert h.game.ending_json() == "null"
    h.run_to(LAST_NIGHT)
    assert h.game.ending_json() == "null"  # the call that holds the ending has not been made
    out = h.send()
    event = ending_of(out)
    assert json.loads(h.game.ending_json()) == event
    assert h.game.ending_json() == canon.dumps_str(event)
    # a game restored from a snapshot has it too
    h.run_to(LAST_NIGHT + 60)
    assert json.loads(Game.from_snapshot_json(h.game.snapshot_json()).ending_json()) == event
    # the scenario without endings has none
    assert Game(1, "m0").ending_json() == "null"


def test_the_hidden_endings_and_the_labels_are_in_the_frame_as_they_are_in_the_event(eve):
    h, out = at_the_end(eve, lambda h: put_beliefs(h, lore.lore().people[:11], "pr_liner_damaged"))
    event = ending_of(out)
    shown = h.send()["frame"]["ending"]
    assert out["frame"]["ending"] == event and shown == compact_of(event)
    assert shown["hidden"] == [
        {
            "id": "hidden_legend_of_lie",
            "label": {"zh": "谎话成了传说", "en": "The lie became a legend"},
        }
    ]
    for rules_id in (r.id for r in (*goals_rules.rules().rows, *goals_rules.rules().hidden)):
        label = goals_ending.label_of(rules_id)
        assert set(label) == {"zh", "en"} and label["zh"] and label["en"]


def test_a_game_that_is_loaded_shows_the_ending_in_its_first_frame_and_has_the_whole_of_it(eve):
    h, out = at_the_end(eve)
    event = ending_of(out)
    h.run_to(LAST_NIGHT + 60)
    # from a snapshot
    loaded = Hand(Game.from_snapshot_json(h.game.snapshot_json()))
    assert loaded.send()["frame"]["ending"] == compact_of(event)
    assert json.loads(loaded.game.ending_json()) == event
    # from a recording, which is what a save is
    recorder = Recorder(Game.from_snapshot_json(eve))
    while recorder.game.tick < LAST_NIGHT + 60:
        recorder.step()
    rebuilt = rebuild(recorder.recording())
    assert rebuilt.hash() == recorder.game.hash()
    assert json.loads(rebuilt.step())["frame"]["ending"] == compact_of(event)
    assert json.loads(rebuilt.ending_json()) == event


# ------------------------------------------------------------------------------ after the end


def test_the_ending_comes_once_and_afterwards_the_section_is_still_and_refuses(eve):
    h, out = at_the_end(eve)
    first = json.loads(json.dumps(h.goals))
    assert h.goals["ending"] and ending_of(out)["tick"] == LAST_NIGHT
    h.run_to(LAST_NIGHT + 600)  # the night, the dawn of a sixth day, and a morning
    assert len(h.kinds("ending")) == 1
    assert [e for e in h.events if e["kind"] in ("flag", "goal", "joined", "agreed")] == []
    assert json.loads(json.dumps(h.goals)) == first
    sim = sim_of(h)
    assert goals.rally(sim) == "over"
    assert goals.join(sim, "li_da") is False
    assert goals.agree_material(sim, "li_da") == 0 and goals.agree_lane(sim, "miaozhu") == 0
    assert goals.set_truth_cleared(sim) is False and goals.set_reconciled(sim) is False
    assert goals.lower_threshold(sim, "li_da") == -1
    goals.spread(sim)  # and the call no longer spreads
    assert h.goals["call"]["joined"] == []
    assert h.acks(h.send(rally())) == [("rejected", "over")]
    assert h.acks(h.send(dev("join", npc="li_da"))) == [("rejected", "no_change")]
    assert h.acks(h.send(dev("grudge", value=3))) == [("rejected", "no_change")]
    assert json.loads(json.dumps(h.goals)) == first


def test_the_numbers_of_the_last_night_stay_on_the_hud_when_the_sky_changes_after_it(eve):
    h, out = at_the_end(eve, None, dev("join", npc="li_da"), dev("join", npc="old_he"))
    hud = out["frame"]["hud"]
    event = ending_of(out)
    assert (
        (hud["promised"], hud["turnout"])
        == (2, event["turnout"])
        == (2, h.goals["ending"]["turnout"])
    )
    h.state["weather"]["plan"].append("heavy_rain")
    h.run_to(LAST_NIGHT + 2 * 2070)
    again = h.frame["hud"]
    assert (again["promised"], again["turnout"], again["ending"]) == (
        2,
        hud["turnout"],
        hud["ending"],
    )
    assert [lantern["household"] for lantern in h.frame["lanterns"]] == ["fam_li", "old_he"]


def test_a_game_nobody_plays_ends_in_a_split_with_no_lanterns_at_all():
    h = hand(7)
    h.run_to(LAST_NIGHT + 1)
    event = h.kinds("ending")
    assert len(event) == 1 and event[0]["ending"] == "ending_split"
    assert h.kinds("joined") == [] and h.kinds("promised") == [] and h.frame["lanterns"] == []
    assert event[0]["promised"] == 0 and event[0]["passage"] == "none"
    assert h.goals["flags"] == {} and h.goals["done"] == {}
    assert h.goals["call"]["open"] == -1


# ------------------------------------------------------------------------------ the turnout


def exact(households, keen, passage, sky):
    pm = {"mended": 1000, "detour": 800, "none": 500}[passage]
    sky_pm = {"clear": 1000, "light_rain": 800, "heavy_rain": 500}[sky]
    return min(10_000, (households * 4 + keen * 50) * pm * sky_pm // 1_000_000)


def test_the_turnout_is_households_times_four_and_keen_townsfolk_times_fifty_less_the_weather():
    for households, keen, how, sky in itertools.product(
        (0, 1, 3, 12), (0, 1, 7, 60, 200), ("mended", "detour", "none"), weather.KINDS
    ):
        assert goals.turnout(households, keen, how, sky) == exact(households, keen, how, sky)
    assert goals.turnout(10, 60, "mended", "clear") == 3040  # (40 + 3000) * 1 * 1
    assert goals.turnout(10, 60, "detour", "clear") == 2432  # * 0.8
    assert goals.turnout(10, 60, "none", "clear") == 1520  # * 0.5
    assert goals.turnout(10, 60, "mended", "light_rain") == 2432
    assert goals.turnout(10, 60, "detour", "light_rain") == 1945  # 3040 * 0.64 = 1945.6, down
    assert goals.turnout(10, 60, "none", "heavy_rain") == 760
    assert goals.turnout(12, 200, "mended", "clear") == 10_000  # 10,048 is held to ten thousand
    assert goals.turnout(0, 199, "mended", "clear") == 9950
    assert goals.turnout(3, 7, "none", "heavy_rain") == 90  # 362 * 0.25 = 90.5, rounded down once


def test_the_hud_shows_the_turnout_of_the_flags_the_crowd_and_the_sky_of_the_frame():
    h = hand(3, weather_clear=0, weather_light=1)
    h.run_to(at(1, 9))
    join_all(h, ("li_da", "zhou_dalang", "old_he"))
    for flags, passage in (
        ({}, "none"),
        ({"detour_done": 1}, "detour"),
        ({"bridge_fixed": 1}, "mended"),
    ):
        h.goals["flags"].clear()
        h.goals["flags"].update(flags)
        hud = h.send()["frame"]["hud"]
        keen = crowd.keen_count(h.state)
        assert hud["promised"] == 3
        assert hud["turnout"] == exact(3, keen, passage, "light_rain")
        assert (
            hud["bridge"]["state"]
            == {"none": "broken", "detour": "detour", "mended": "mended"}[passage]
        )


# ------------------------------------------------------------------------------ the frame


def test_the_frame_carries_the_lanterns_and_the_hud_numbers_as_plain_ints_and_strings():
    h = hand(3)
    h.run_to(at(1, 8))
    join_all(h, ("li_da", "zhou_dalang", "old_he"))
    for _ in range(300):
        out = h.send()
        frame = out["frame"]
        assert set(FRAME_KEYS) <= set(frame)
        assert canon.dumps_str(canon.loads(json.dumps(frame))) == canon.dumps_str(frame)
        hud = frame["hud"]
        assert type(hud["promised"]) is int and type(hud["turnout"]) is int
        assert hud["ending"] == ""
        bridge = hud["bridge"]
        counts = ("done", "need", "percent", "hours", "hours_need", "short")
        assert set(bridge) >= {*counts, "state", "families_missing"}
        assert set(bridge) <= {*counts, "state", "families_missing", "lacking"}
        assert all(type(bridge[k]) is int for k in counts)
        assert type(bridge["families_missing"]) is list
        assert bridge["state"] in ("broken", "repairing", "mended", "detour")
        assert len(frame["lanterns"]) == hud["promised"] == 3
        for lantern in frame["lanterns"]:
            assert set(lantern) == {"household", "place", "x", "y"}
            assert type(lantern["x"]) is int and type(lantern["y"]) is int


def test_a_lantern_hangs_where_the_household_has_its_door_and_in_the_order_they_promised():
    h = hand(3)
    h.run_to(5)
    lanterns = []
    for person, household in (("miaozhu", "miaozhu"), ("li_er", "fam_li"), ("gengfu", "gengfu")):
        join_all(h, (person,))
        lanterns.append(household)
        assert [lan["household"] for lan in h.frame["lanterns"]] == lanterns
    door = {lan["household"]: (lan["place"], lan["x"], lan["y"]) for lan in h.frame["lanterns"]}
    town = world_of(h.game).town
    for place, x, y in door.values():
        assert town.places[place].door == (x, y)


def test_the_rally_verb_is_offered_while_the_player_is_free_and_the_call_has_not_been_made():
    h = hand(3)
    verbs = h.send()["frame"]["hud"]["verbs"]
    assert "rally" in verbs and "move" in verbs
    assert verbs == [v for v in player.VERB_ORDER if v in verbs]  # in the order of the verbs
    assert "rally" not in h.send(rally())["frame"]["hud"]["verbs"]
    assert "rally" not in h.send()["frame"]["hud"]["verbs"]
    assert "move" in h.frame["hud"]["verbs"]


def test_the_rally_verb_is_not_offered_after_the_last_night(eve):
    _, out = at_the_end(eve)
    assert "rally" not in out["frame"]["hud"]["verbs"]


def test_the_flag_of_the_truth_goes_by_two_names():
    h = hand(3)
    h.run_to(3)
    sim = sim_of(h)
    assert not goals.flag_up(h.state, "truth_cleared") and not goals.flag_up(h.state, "truth_told")
    assert goals.set_flag(sim, "truth_cleared") is True
    assert goals.flag_up(h.state, "truth_cleared") and goals.flag_up(h.state, "truth_told")
    assert "truth_told" in h.goals["flags"] and "truth_cleared" not in h.goals["flags"]
    assert goals.set_flag(sim, "truth_told") is False


# ------------------------------------------------------------------------------ the actions


def test_the_rally_action_takes_no_fields_and_is_always_there():
    h = Hand(Game(3, "bridge"))  # no dev actions
    out = h.send({"action_id": "r", "type": "rally", "extra": 5})
    assert h.acks(out) == [("applied", None)]
    assert h.game.last_inputs[0]["body"] == {"action_id": "r", "type": "rally"}
    with pytest.raises(InputError, match="unknown type"):
        h.send(dev("join", npc="li_da"))


@pytest.mark.parametrize(
    "fields, message",
    [
        ({"op": "dance"}, "op must be one of"),
        ({"op": "join"}, "unknown npc"),
        ({"op": "join", "npc": "nobody"}, "unknown npc"),
        ({"op": "material", "npc": 5}, "unknown npc"),
        ({"op": "grudge", "value": 101}, "value must be an int in"),
        ({"op": "grudge", "value": -1}, "value must be an int in"),
        ({"op": "grudge", "value": "5"}, "value must be an int in"),
    ],
)
def test_a_dev_action_that_is_not_well_formed_is_refused(fields, message):
    h = hand(3)
    with pytest.raises(InputError, match=message):
        h.send(body("dev_goal", **fields))
    assert h.game.tick == 0


def test_a_dev_action_is_normalized_and_a_resent_action_acts_once():
    h = hand(3)
    action = {**dev("join", npc="li_da", value=77, junk=1), "action_id": "once"}
    out = h.send(action)
    assert h.game.last_inputs[0]["body"] == {
        "action_id": "once",
        "type": "dev_goal",
        "op": "join",
        "npc": "li_da",
        "value": 0,
    }
    assert h.acks(out) == [("applied", None)]
    again = h.send(action)
    assert [e["result"] for e in again["events"] if e["kind"] == "action_ack"] == ["duplicate"]
    assert goals.joined(h.state) == ["li_da"]
    assert DEV == {"dev_actions": 1} and HELPERS and rally() == {"type": "rally"}
