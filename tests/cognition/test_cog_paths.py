"""The four authorization paths: what each allows, what it records, and how modality travels."""

import itertools

import pytest
from cog_world import PROPS, PUBLIC, REGISTRY, RULES, TABLES, TEMPLATES, has_grudge

from lantern_core.cognition.beliefs import Belief, BeliefStore, Claim
from lantern_core.cognition.paths import (
    PathError,
    authorize,
    authorize_ignorance,
    backing_prop,
    lie_notes,
    listener_belief,
    speaker_belief,
)
from lantern_core.cognition.rules import LieEnvelope, SpecRule


def store(holder, *beliefs):
    return BeliefStore(holder, list(beliefs))


def saw(holder, prop, tick=0, conf=95):
    return Belief(holder, prop, "assert", conf, "saw", None, None, 0, tick, None)


def heard(holder, prop, teller, claimed, hop, modality="assert", tick=0, conf=60):
    return Belief(holder, prop, modality, conf, "heard", teller, claimed, hop, tick, "c0")


def guessed(holder, prop, tick=0, conf=40):
    return Belief(holder, prop, "speculate", conf, "inferred", None, None, 0, tick, None)


def say(speaker, prop, modality, claimed, path, listeners=None, tick=100, **kw):
    listeners = listeners or (("wang",) if speaker == "zhou" else ("zhou",))
    return Claim("c1", speaker, tuple(listeners), prop, modality, claimed, tick, path, **kw)


def verdict(claim, speaker_store, **kw):
    kw.setdefault("tables", TABLES)
    kw.setdefault("registry", REGISTRY)
    kw.setdefault("rules", RULES)
    kw.setdefault("templates", TEMPLATES)
    kw.setdefault("relation", has_grudge)
    kw.setdefault("public", PUBLIC)
    return authorize(claim, speaker_store, PROPS, **kw)


def refused(claim, speaker_store, code, **kw):
    ok, reason = verdict(claim, speaker_store, **kw)
    assert not ok and reason.startswith(code + ":"), reason


# ------------------------------------------------------------------ the belief path


def test_a_belief_is_said_as_it_is_held_and_the_listener_is_one_hop_further():
    s = store("clerk", saw("clerk", "r0_damaged"))
    c = say("clerk", "r0_damaged", "assert", "self_seen", "belief")
    assert verdict(c, s) == (True, "ok")
    got = listener_belief(c, "zhou", s, PROPS, confidence=70)
    assert got == Belief(
        "zhou", "r0_damaged", "assert", 70, "heard", "clerk", "self_seen", 1, 100, "c1"
    )
    assert speaker_belief(c, s, PROPS) is None  # already in the store, nothing to add


def test_a_guess_that_is_repeated_stays_a_guess():
    s = store("wang", guessed("wang", "li_broke"))
    c = say("wang", "li_broke", "speculate", "wang", "belief")
    assert verdict(c, s)[0]
    assert listener_belief(c, "zhou", s, PROPS, confidence=30).modality == "speculate"


def test_second_hand_news_names_the_one_who_told_it_and_adds_a_hop():
    s = store("zhou", heard("zhou", "r0_damaged", "clerk", "self_seen", 1))
    c = say("zhou", "r0_damaged", "assert", "clerk", "belief", listeners=("wang",))
    assert verdict(c, s)[0]
    assert listener_belief(c, "wang", s, PROPS, confidence=50).hop == 2


def test_the_source_may_be_hidden_but_not_changed():
    s = store("zhou", heard("zhou", "r0_damaged", "clerk", "self_seen", 1))
    assert verdict(say("zhou", "r0_damaged", "assert", "unknown", "belief"), s)[0]
    refused(
        say("zhou", "r0_damaged", "assert", "self_seen", "belief"), s, "source"
    )  # false witness
    refused(say("zhou", "r0_damaged", "assert", "wang", "belief"), s, "source")  # another name


def test_a_hidden_source_reaches_the_listener_as_unknown_with_the_speaker_still_the_teller():
    s = store("zhou", heard("zhou", "r0_damaged", "clerk", "self_seen", 1))
    c = say("zhou", "r0_damaged", "assert", "unknown", "belief", listeners=("wang",))
    got = listener_belief(c, "wang", s, PROPS, confidence=40)
    assert (got.teller, got.claimed_source, got.hop) == ("zhou", "unknown", 2)


def test_the_belief_path_refuses_what_the_speaker_does_not_hold_or_cannot_yet_hold():
    s = store("clerk", saw("clerk", "r0_damaged", tick=500))
    refused(say("clerk", "r1_broke", "assert", "self_seen", "belief"), s, "no_belief")
    refused(say("clerk", "r0_damaged", "assert", "self_seen", "belief"), s, "premature")
    refused(say("clerk", "gone", "assert", "self_seen", "belief"), s, "unknown_prop")
    refused(say("zhou", "r0_damaged", "assert", "self_seen", "belief"), s, "wrong_store")


def test_a_denial_is_a_negated_prop_the_speaker_holds_as_an_assertion():
    s = store("li2", saw("li2", "li_not_broke"), saw("li2", "li_broke"))
    c = say("li2", "li_not_broke", "deny", "self_seen", "belief")
    assert verdict(c, s)[0]
    assert listener_belief(c, "zhou", s, PROPS, confidence=60).modality == "assert"
    refused(say("li2", "li_broke", "deny", "self_seen", "belief"), s, "deny_needs_negation")
    guess = store("li2", guessed("li2", "li_not_broke"))
    refused(say("li2", "li_not_broke", "deny", "li2", "belief"), guess, "modality")


# ------------------------------------------------------------------ the speculation path


def wang_knows():
    """Wang saw Li Er at the bridge. That the bridge has a broken rail is known to the town."""
    return store("wang", saw("wang", "li_at_bridge", tick=10))


PREMISES = ("li_at_bridge", "rail_located", "rail_broken")


def guess_claim(**kw):
    base = {"rule_id": "grudge_at_scene", "premises": PREMISES}
    base.update(kw)
    return say("wang", "li_broke", "speculate", "wang", "speculation", **base)


def test_a_guess_follows_a_script_rule_and_is_recorded_on_both_sides():
    s = wang_knows()
    c = guess_claim()
    assert verdict(c, s, suspicion=30) == (True, "ok")
    # what the town knows counts as sure, so the guess is as firm as the one thing Wang saw
    mine = speaker_belief(c, s, PROPS, public=PUBLIC)
    assert mine == Belief("wang", "li_broke", "speculate", 95, "inferred", None, None, 0, 100, "c1")
    theirs = listener_belief(c, "zhou", s, PROPS, confidence=35)
    assert (theirs.modality, theirs.source, theirs.teller, theirs.claimed_source, theirs.hop) == (
        "speculate",
        "heard",
        "wang",
        "wang",
        1,
    )
    assert speaker_belief(c, s, PROPS, confidence=22, public=PUBLIC).confidence == 22


def test_a_premise_may_be_held_or_known_to_the_town_and_the_weakest_sets_the_confidence():
    held = store(
        "wang",
        saw("wang", "li_at_bridge", tick=10, conf=80),
        saw("wang", "rail_located", tick=10, conf=60),
        saw("wang", "rail_broken", tick=10, conf=70),
    )
    c = guess_claim()
    assert verdict(c, held, suspicion=30, public=()) == (True, "ok")
    assert speaker_belief(c, held, PROPS).confidence == 60
    # a premise both held and known is as the speaker holds it
    assert speaker_belief(c, held, PROPS, public=PUBLIC).confidence == 60
    # nothing held at all: every premise would have to be public
    bare = store("wang")
    everyone = frozenset(PREMISES)
    assert verdict(c, bare, suspicion=30, public=everyone)[0]
    assert speaker_belief(c, bare, PROPS, public=everyone).confidence == 100
    refused(c, bare, "premises", suspicion=30, public=PUBLIC)  # Wang did not see Li Er
    with pytest.raises(PathError):
        speaker_belief(c, bare, PROPS, public=PUBLIC)


@pytest.mark.parametrize(
    ("change", "code", "suspicion"),
    [
        ({"rule_id": "made_up"}, "unknown_rule", 99),
        ({}, "suspicion", 29),
        ({"premises": ("li_at_bridge",)}, "premises", 99),
        ({"premises": ("rail_broken", "rail_located", "li_at_bridge")}, "premises", 99),  # order
        ({"premises": ("li_at_bridge", "rail_located", "he_home")}, "premises", 99),  # no fit
        ({"premises": ("li_at_bridge", "rail_located", "ghost")}, "premises", 99),  # not a prop
        ({"premises": ("li_at_bridge", "li_not_broke", "rail_broken")}, "premises", 99),
        ({"modality": "assert"}, "modality", 99),
        ({"prop": "he_broke"}, "conclusion", 99),  # not what the rule concludes
        ({"prop": "li_not_broke"}, "conclusion", 99),  # a denial is not a guess
        ({"claimed_source": "clerk"}, "source", 99),
    ],
)
def test_a_guess_that_does_not_fit_its_rule_is_refused(change, code, suspicion):
    s = wang_knows()
    base = guess_claim().to_canon()
    base.update(change)
    base["listeners"] = tuple(base["listeners"])
    base["premises"] = tuple(base["premises"])
    refused(Claim(**base), s, code, suspicion=suspicion)


def test_a_premise_the_speaker_does_not_hold_and_the_town_does_not_know_is_refused():
    s = wang_knows()
    refused(guess_claim(), s, "premises", suspicion=99, public=frozenset({"rail_located"}))
    refused(guess_claim(), s, "premises", suspicion=99, public=())
    late = store("wang", saw("wang", "li_at_bridge", tick=500))
    refused(guess_claim(), late, "premature", suspicion=99)  # learnt after the claim at 100
    # what the town knows needs no date
    assert verdict(
        guess_claim(), store("wang", saw("wang", "li_at_bridge", tick=10)), suspicion=99
    )[0]


def test_the_rule_asks_for_the_relation_between_the_speaker_and_the_one_it_binds():
    s = wang_knows()
    asked = []

    def ask(kind, holder, target):
        asked.append((kind, holder, target))
        return True

    assert verdict(guess_claim(), s, suspicion=30, relation=ask)[0]
    assert asked == [("grudge", "wang", "li2")]  # the kind, the speaker, and who $X is
    refused(guess_claim(), s, "relation", suspicion=30, relation=lambda *a: False)
    refused(guess_claim(), s, "relation", suspicion=30, relation=None)  # no answer is a no


def test_the_rule_binds_the_speaker_so_only_the_one_with_the_grudge_may_use_it():
    s = store("zhou", saw("zhou", "li_at_bridge"))  # the grudge is wang's
    c = say(
        "zhou",
        "li_broke",
        "speculate",
        "zhou",
        "speculation",
        rule_id="grudge_at_scene",
        premises=PREMISES,
    )
    refused(c, s, "relation", suspicion=99)
    assert verdict(c, s, suspicion=99, relation=lambda kind, holder, target: holder == "zhou")[0]


def test_a_rule_without_a_relation_needs_no_answer():
    free = RULES["grudge_at_scene"].to_canon() | {"id": "free", "relation": None}
    rule = SpecRule.from_canon(free)
    s = store("zhou", saw("zhou", "li_at_bridge"))
    c = say(
        "zhou", "li_broke", "speculate", "zhou", "speculation", rule_id="free", premises=PREMISES
    )
    assert verdict(c, s, suspicion=99, rules={"free": rule}, relation=None) == (True, "ok")


# ------------------------------------------------------------------ the mutation path


@pytest.mark.parametrize(
    ("parent", "child", "op"),
    [
        ("r0_damaged", "r1_broke", "sharpen"),
        ("r1_broke", "r2_revenge", "fill"),
        ("r2_revenge", "r3_li3", "assimilate"),
        ("r0_damaged", "r0_fam", "assimilate"),  # a person for the family
        ("r1_broke", "r2_nowhere", "level"),
        ("r1_broke", "r1_same", "level"),  # drops nothing
        ("li_looked", "li_looked_at", "level"),  # to the predicate the table names
    ],
)
def test_a_mutation_follows_the_modality_of_the_belief_it_changes(parent, child, op):
    for modality, held in (("assert", saw), ("speculate", guessed)):
        s = store("clerk", held("clerk", parent))
        c = mutate("clerk", child, op, modality, Belief.honest_source(held("clerk", parent)))
        assert verdict(c, s) == (True, "ok"), (op, modality)
        got = listener_belief(c, "zhou", s, PROPS, confidence=50)
        assert got.modality == modality and got.hop == 1 and got.claim == "c1"
        mine = speaker_belief(c, s, PROPS)
        assert (mine.prop, mine.source, mine.modality) == (child, "inferred", modality)
        assert mine.confidence == s.get(parent).confidence and mine.hop == 0


@pytest.mark.parametrize(
    ("child", "op", "ok"),
    [
        ("r2_nowhere", "level", True),
        ("r1_same", "level", True),  # dropping nothing is how the hedge goes
        ("li_looked_at", "level", True),
        ("r2_revenge", "fill", False),
        ("r1_broke", "sharpen", False),
        ("r0_fam", "assimilate", False),
    ],
)
def test_only_the_level_operator_may_turn_a_guess_into_an_assertion(child, op, ok):
    parent = PROPS[child].parent
    s = store("wang", guessed("wang", parent))
    c = mutate("wang", child, op, "assert", "wang")
    if ok:
        assert verdict(c, s) == (True, "ok")
        got = listener_belief(c, "zhou", s, PROPS, confidence=50)
        assert got.modality == "assert"  # the guess is gone, and the claim keeps the operator
        assert c.op == "level"
    else:
        refused(c, s, "modality")


def test_leveling_never_makes_an_assertion_into_a_guess_and_never_says_deny_or_lie():
    s = store("clerk", saw("clerk", "r1_broke"))
    refused(mutate("clerk", "r2_nowhere", "level", "speculate", "self_seen"), s, "modality")
    refused(mutate("clerk", "r2_nowhere", "level", "deny", "self_seen"), s, "modality")
    refused(mutate("clerk", "r2_nowhere", "level", "lie", "self_seen"), s, "modality")


def test_a_mutation_must_name_the_operator_that_made_the_prop_and_fit_its_shape():
    s = store("clerk", saw("clerk", "r1_broke"))
    refused(mutate("clerk", "r2_nowhere", "sharpen", "assert", "self_seen"), s, "op")
    refused(say("clerk", "r2_nowhere", "assert", "self_seen", "mutation"), s, "extras")
    refused(mutate("clerk", "li_broke", "level", "assert", "self_seen"), s, "not_a_mutation")
    # the parent is held, but the claim attributes the change to the wrong parent's source
    refused(mutate("clerk", "r2_nowhere", "level", "assert", "wang"), s, "source")


def test_a_mutation_needs_the_parent_belief_not_just_the_child():
    s = store("clerk", saw("clerk", "r2_nowhere"))
    refused(mutate("clerk", "r2_nowhere", "level", "assert", "self_seen"), s, "no_belief")
    assert backing_prop(mutate("clerk", "r2_nowhere", "level", "assert", "x"), PROPS) == "r1_broke"


def by_rule(speaker="wang", **kw):
    """Wang, who saw Li Er at the bridge, says that Li Er damaged the rail, by the rule."""
    kw.setdefault("rule_id", "scene_damage")
    return mutate(speaker, "li_damaged_by_rule", "assimilate", "assert", "self_seen", **kw)


def mutate(speaker, prop, op, modality, claimed, listeners=("zhou",), **kw):
    return say(speaker, prop, modality, claimed, "mutation", listeners=listeners, op=op, **kw)


def saw_at_bridge(*more):
    return store("wang", saw("wang", "li_at_bridge", tick=10), *more)


def test_an_assimilation_that_changes_the_predicate_is_said_by_a_rule():
    s = saw_at_bridge()
    c = by_rule()
    assert verdict(c, s, suspicion=20) == (True, "ok")
    got = listener_belief(c, "zhou", s, PROPS, confidence=50)
    assert (got.modality, got.hop, got.teller, got.claimed_source) == (
        "assert",
        1,
        "wang",
        "self_seen",
    )
    mine = speaker_belief(c, s, PROPS)
    assert (mine.prop, mine.source, mine.modality, mine.hop) == (
        "li_damaged_by_rule",
        "inferred",
        "assert",
        0,
    )
    # the other premises may be held by the speaker as well as known to the town
    held = saw_at_bridge(saw("wang", "rail_located", tick=10), saw("wang", "rail_broken", tick=10))
    assert verdict(c, held, suspicion=20, public=()) == (True, "ok")


GUESSED_IT = mutate(
    "wang", "li_damaged_by_rule", "assimilate", "speculate", "self_seen", rule_id="scene_damage"
)


@pytest.mark.parametrize(
    ("claim", "code", "kw"),
    [
        (by_rule(rule_id=None), "extras", {}),  # the rule must be named
        (by_rule(rule_id="made_up"), "unknown_rule", {}),
        (by_rule(rule_id="grudge_at_scene"), "op", {"suspicion": 99}),  # it concludes broke
        (by_rule(premises=PREMISES), "extras", {}),  # the premises are found, not listed
        (by_rule(), "suspicion", {"suspicion": 19}),
        (by_rule(), "relation", {"suspicion": 20, "relation": None}),
        (by_rule(), "relation", {"suspicion": 20, "relation": lambda *a: False}),
        (by_rule(), "premises", {"suspicion": 20, "public": frozenset({"rail_located"})}),
        (by_rule(), "premises", {"suspicion": 20, "public": ()}),
        (GUESSED_IT, "modality", {"suspicion": 20}),  # a belief held for sure is not a guess
    ],
)
def test_an_assimilation_by_rule_is_refused_when_the_rule_does_not_fit_the_speaker(claim, code, kw):
    refused(claim, saw_at_bridge(), code, **kw)


def test_the_rule_for_a_changed_predicate_is_named_only_when_the_predicate_changes():
    s = store("clerk", saw("clerk", "r0_damaged"))
    extra = mutate("clerk", "r1_broke", "sharpen", "assert", "self_seen", rule_id="scene_damage")
    refused(extra, s, "extras", suspicion=99)
    # the same holds for the assimilation that only swaps an argument
    s = store("clerk", saw("clerk", "r2_revenge"))
    swap = mutate("clerk", "r3_li3", "assimilate", "assert", "self_seen", rule_id="scene_damage")
    refused(swap, s, "extras", suspicion=99)


def test_the_rule_cannot_use_a_premise_that_was_learnt_after_the_claim():
    late = saw_at_bridge(
        saw("wang", "rail_located", tick=500), saw("wang", "rail_broken", tick=500)
    )
    refused(by_rule(), late, "premises", suspicion=20, public=())
    assert verdict(by_rule(tick=600), late, suspicion=20, public=())[0]


def test_the_parent_must_be_held_for_a_rule_too():
    refused(by_rule(), store("wang"), "no_belief", suspicion=99)
    refused(
        by_rule(), store("wang", saw("wang", "li_at_bridge", tick=500)), "premature", suspicion=99
    )


# ------------------------------------------------------------------ the lie path


def lie(speaker="he", prop="he_home", claimed="self_seen", modality="lie", **kw):
    kw.setdefault("template_id", "he_at_home")
    return say(speaker, prop, modality, claimed, "lie", **kw)


def test_a_lie_comes_from_a_template_and_is_heard_as_an_assertion():
    s = store("he", saw("he", "he_under_bridge"))
    c = lie(listeners=("zhou", "wang"))
    assert verdict(c, s) == (True, "ok")
    got = listener_belief(c, "wang", s, PROPS, confidence=65)
    assert (got.modality, got.source, got.claimed_source, got.hop) == (
        "assert",
        "heard",
        "self_seen",
        1,
    )
    assert speaker_belief(c, s, PROPS) is None
    assert [(n.prop, n.listener, n.claim) for n in lie_notes(c)] == [
        ("he_home", "zhou", "c1"),
        ("he_home", "wang", "c1"),
    ]
    assert lie_notes(say("he", "he_home", "assert", "unknown", "belief")) == ()


@pytest.mark.parametrize(
    ("claim", "code"),
    [
        (lie(template_id="made_up"), "unknown_template"),
        (lie(speaker="wang"), "template_speaker"),
        (lie(prop="he_under_bridge"), "template_prop"),
        (lie(prop="he_market_late"), "template_prop"),
        (lie(claimed="clerk"), "template_source"),
        (lie(modality="assert"), "modality"),
        (say("he", "he_home", "lie", "self_seen", "lie"), "extras"),
        (lie(template_id="he_knows_nothing"), "template_kind"),  # that claims no prop
    ],
)
def test_a_lie_outside_its_template_is_refused(claim, code):
    refused(claim, store(claim.speaker, saw(claim.speaker, "he_under_bridge")), code)


def sourced(kind, holder="he", told_by=None, prop="he_home"):
    """An envelope with one template that claims ``prop`` under a source of this kind."""
    source = {"kind": kind, "from": told_by}
    template = {
        "id": f"lie_{kind}",
        "kind": "claim",
        "prop": prop,
        "source": source,
        "about": None,
        "source_only": False,
    }
    return LieEnvelope.from_canon(
        {
            "holder": holder,
            "motive": "fear",
            "preds": ["at"],
            "ignorance": [],
            "objects": [holder, "home_he"],
            "sources": [kind],
            "templates": [template],
        }
    )


@pytest.mark.parametrize(
    ("kind", "told_by", "named"),
    [
        ("witnessed", None, "self_seen"),
        ("heard", "zhou", "zhou"),
        ("guessed", None, "he"),
        ("gossip", None, "unknown"),
        ("gazette", None, "unknown"),
    ],
)
def test_a_lie_names_the_source_its_template_maps_to_and_no_other(kind, told_by, named):
    envelope = sourced(kind, told_by=told_by)
    templates = {t.id: t for t in envelope.templates}
    s = store("he")
    ok = lie(claimed=named, template_id=f"lie_{kind}")
    assert verdict(ok, s, templates=templates) == (True, "ok")
    for other in ("self_seen", "unknown", "he", "zhou", "wang"):
        if other != named:
            refused(
                lie(claimed=other, template_id=f"lie_{kind}"),
                s,
                "template_source",
                templates=templates,
            )


def test_a_feigned_ignorance_belongs_to_the_one_it_is_written_for():
    assert authorize_ignorance("he", "he_knows_nothing", TEMPLATES) == (True, "ok")
    assert TEMPLATES["he_knows_nothing"].about == "damaged"
    for speaker, template_id, code in (
        ("wang", "he_knows_nothing", "template_speaker"),
        ("he", "he_at_home", "template_kind"),  # a claim, not an ignorance
        ("he", "made_up", "unknown_template"),
    ):
        ok, reason = authorize_ignorance(speaker, template_id, TEMPLATES)
        assert not ok and reason.startswith(code + ":"), reason


# ------------------------------------------------------------------ guesses and assertions


def test_a_guess_becomes_an_assertion_only_through_level_or_a_lie():
    """Every route a speaker holding a guess could take to say it as fact, tried in turn."""
    s = store(
        "he",
        guessed("he", "r0_damaged"),
        guessed("he", "r1_broke"),
        guessed("he", "r2_revenge"),
        guessed("he", "he_home"),
    )
    rule = {"rule_id": "grudge_at_scene", "premises": ("a", "b")}
    routes = {
        # the guess said plainly as an assertion, a denial or a lie
        "belief/assert": (say("he", "r1_broke", "assert", "he", "belief"), "modality"),
        "belief/deny": (say("he", "r1_broke", "deny", "he", "belief"), "modality"),
        "belief/lie": (say("he", "r1_broke", "lie", "he", "belief"), "modality"),
        # through a rule, which only ever produces guesses
        "speculation/assert": (
            say("he", "r1_broke", "assert", "he", "speculation", **rule),
            "modality",
        ),
        # through an operator that does not drop the hedge
        "mutation/sharpen": (mutate("he", "r1_broke", "sharpen", "assert", "he"), "modality"),
        "mutation/fill": (mutate("he", "r2_revenge", "fill", "assert", "he"), "modality"),
        "mutation/assimilate": (mutate("he", "r3_li3", "assimilate", "assert", "he"), "modality"),
        # a lie that is not written down in a template for this prop
        "lie/other-prop": (lie(prop="r1_broke"), "template_prop"),
        "lie/no-template": (say("he", "he_home", "lie", "he", "lie"), "extras"),
    }
    for name, (claim, code) in routes.items():
        ok, reason = verdict(claim, s, suspicion=99)
        assert not ok and reason.startswith(code + ":"), (name, reason)
    # and the two ways that work
    assert verdict(mutate("he", "r2_nowhere", "level", "assert", "he"), s) == (True, "ok")
    assert verdict(lie(), s) == (True, "ok")


def test_what_the_listener_records_for_each_path_when_the_speaker_holds_a_guess():
    s = store("he", guessed("he", "r1_broke"))
    levelled = mutate("he", "r2_nowhere", "level", "assert", "he")
    assert listener_belief(levelled, "zhou", s, PROPS, confidence=50).modality == "assert"
    kept = mutate("he", "r2_revenge", "fill", "speculate", "he")
    assert listener_belief(kept, "zhou", s, PROPS, confidence=50).modality == "speculate"


# ------------------------------------------------------------------ misuse and round trips


def test_the_writers_refuse_what_the_gate_would_have_refused():
    s = store("clerk", saw("clerk", "r0_damaged"))
    c = say("clerk", "r0_damaged", "assert", "self_seen", "belief")
    with pytest.raises(PathError):
        listener_belief(c, "wang", s, PROPS, confidence=50)  # not a listener
    nothing = mutate("clerk", "r1_broke", "sharpen", "assert", "self_seen")
    with pytest.raises(PathError):
        listener_belief(nothing, "zhou", store("clerk"), PROPS, confidence=50)
    with pytest.raises(PathError):
        speaker_belief(nothing, store("clerk"), PROPS)
    with pytest.raises(PathError):
        speaker_belief(guess_claim(), store("wang"), PROPS)


# ------------------------------------------------------------------ modality, path by path


def _belief_path_case(held, modality):
    s = store("clerk", held)
    return s, say("clerk", "r0_damaged", modality, held.honest_source(), "belief")


def _speculation_case(premise_modality):
    make = saw if premise_modality == "assert" else guessed
    s = store("wang", make("wang", "li_at_bridge", 10))
    return s, guess_claim()


def _mutation_case(held, op, child, modality):
    s = store("clerk", held)
    return s, mutate("clerk", child, op, modality, held.honest_source())


@pytest.mark.parametrize(
    ("case", "expected"),
    [
        (lambda: _belief_path_case(saw("clerk", "r0_damaged"), "assert"), "assert"),
        (lambda: _belief_path_case(guessed("clerk", "r0_damaged"), "speculate"), "speculate"),
        (lambda: _speculation_case("assert"), "speculate"),
        (lambda: _speculation_case("speculate"), "speculate"),
        (
            lambda: _mutation_case(saw("clerk", "r0_damaged"), "sharpen", "r1_broke", "assert"),
            "assert",
        ),
        (
            lambda: _mutation_case(
                guessed("clerk", "r0_damaged"), "sharpen", "r1_broke", "speculate"
            ),
            "speculate",
        ),
        (
            lambda: _mutation_case(guessed("clerk", "r1_broke"), "level", "r2_nowhere", "assert"),
            "assert",
        ),
        (
            lambda: _mutation_case(
                guessed("clerk", "r1_broke"), "level", "r2_nowhere", "speculate"
            ),
            "speculate",
        ),
        (lambda: (store("he", guessed("he", "he_home")), lie()), "assert"),
    ],
)
def test_modality_travels_along_each_path_into_the_listeners_belief(case, expected):
    s, claim = case()
    assert verdict(claim, s, suspicion=99) == (True, "ok")
    assert listener_belief(claim, claim.listeners[0], s, PROPS, confidence=50).modality == expected


def test_a_belief_cannot_be_said_more_weakly_than_it_is_held_either():
    s = store("clerk", saw("clerk", "r0_damaged"))
    refused(say("clerk", "r0_damaged", "speculate", "self_seen", "belief"), s, "modality")


# ------------------------------------------------------------------ every combination, once

SCENARIOS = [  # (speaker, path, prop said, extra claim fields, the props the belief is in)
    ("he", "belief", "r0_damaged", {}, ["r0_damaged"]),
    ("he", "belief", "li_not_broke", {}, ["li_not_broke"]),
    ("he", "mutation", "r1_broke", {"op": "sharpen"}, ["r0_damaged"]),
    ("he", "mutation", "r2_revenge", {"op": "fill"}, ["r1_broke"]),
    ("he", "mutation", "r3_li3", {"op": "assimilate"}, ["r2_revenge"]),
    ("he", "mutation", "r2_nowhere", {"op": "level"}, ["r1_broke"]),
    (
        "wang",  # the rule is about the speaker's own grudge
        "speculation",
        "li_broke",
        {"rule_id": "grudge_at_scene", "premises": PREMISES},
        ["li_at_bridge"],  # the other two premises are known to the whole town
    ),
    ("he", "lie", "he_home", {"template_id": "he_at_home"}, ["he_home"]),
]
HELD_AS = {
    "none": None,
    "saw": lambda who, p: saw(who, p),
    "heard": lambda who, p: heard(who, p, "clerk", "self_seen", hop=2),
    "guess": lambda who, p: guessed(who, p),
    "own_assertion": lambda who, p: Belief(
        who, p, "assert", 50, "inferred", None, None, 1, 0, None
    ),
}


def test_over_every_combination_a_guess_reaches_an_assertion_only_by_level_or_lie():
    """Eight things to say, five ways of holding what they rest on, four modalities, five
    sources and two levels of suspicion: 1,600 claims, each authorized or refused, and each
    authorized one checked for what it writes into the listener's store."""
    authorized = {}
    guesses_made_assertions = set()
    for (
        speaker,
        path,
        prop,
        extra,
        rests_on,
    ), held_as, modality, source, suspicion in itertools.product(
        SCENARIOS,
        HELD_AS,
        ["assert", "speculate", "deny", "lie"],
        ["he", "self_seen", "unknown", "clerk", "wang"],
        [0, 99],
    ):
        make = HELD_AS[held_as]
        s = store(speaker, *([] if make is None else [make(speaker, p) for p in rests_on]))
        claim = say(speaker, prop, modality, source, path, **extra)
        ok, reason = verdict(claim, s, suspicion=suspicion)
        assert isinstance(reason, str) and (reason == "ok") == ok
        if not ok:
            continue
        authorized[path] = authorized.get(path, 0) + 1
        got = listener_belief(claim, "zhou", s, PROPS, confidence=50)
        own = speaker_belief(claim, s, PROPS, public=PUBLIC)
        assert (got.holder, got.teller, got.claim, got.source) == ("zhou", speaker, "c1", "heard")
        assert got.claimed_source == source and got.tick == claim.tick
        backing = backing_prop(claim, PROPS)
        held = None if backing is None else s.get(backing)
        assert got.hop == (1 if held is None else held.hop + 1)
        about = held if path != "lie" else s.get(claim.prop)  # a liar may hold a guess of it
        guess = path == "speculation" or (about is not None and about.modality == "speculate")
        if guess and got.modality == "assert":
            assert path == "lie" or (path == "mutation" and claim.op == "level")
            guesses_made_assertions.add("lie" if path == "lie" else claim.op)
        if path == "speculation":
            assert got.modality == "speculate" and own.source == "inferred"
        if path == "lie":
            assert got.modality == "assert" and own is None
        if path == "belief":
            said_weakly = modality == "speculate"
            assert own is None and got.modality == ("speculate" if said_weakly else "assert")
    assert set(authorized) == {"belief", "mutation", "speculation", "lie"}
    assert all(n >= 4 for n in authorized.values()), authorized
    assert guesses_made_assertions == {"level", "lie"}  # the two exceptions do occur
