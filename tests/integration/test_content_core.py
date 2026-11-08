"""The core's own checks, run over the real compiled content.

The content (``content/``, built by ``tools/check_content.py``) and the cognition model of the
core (``core/lantern_core/cognition/``) were written apart. These tests load the compiled files
with the core's loaders and let the core judge them: every prop, every group, every rule and
lie template, every hop of every rumour chain, and every guess the rules allow. Nothing here
reimplements a rule of the core, except where an independent count is the point.
"""

from __future__ import annotations

import itertools
from pathlib import Path

import pytest

from lantern_core import canon
from lantern_core.cognition.beliefs import Belief, BeliefStore, Claim
from lantern_core.cognition.paths import (
    authorize,
    authorize_ignorance,
    lie_notes,
    listener_belief,
    speaker_belief,
)
from lantern_core.cognition.props import (
    Event,
    Registry,
    Tables,
    check_prop,
    is_true,
)
from lantern_core.cognition.provenance import walk_back
from lantern_core.cognition.rules import SpecRule
from lantern_core.cognition.script import ScriptBook

COMPILED = Path(__file__).resolve().parents[2] / "content" / "compiled"
SCRIPTS = ("broken_bridge", "lost_lantern", "stranger")

TABLES = Tables.loads((COMPILED / "tables.json").read_bytes())
ENTITIES = Registry.loads((COMPILED / "entities.json").read_bytes())
RAW = {name: canon.loads((COMPILED / f"{name}.json").read_bytes()) for name in SCRIPTS}
BOOKS = {name: ScriptBook.loads((COMPILED / f"{name}.json").read_bytes()) for name in SCRIPTS}

# The standing between people that the rules ask the game about. The core knows none of it, so
# the test spells out whom each speaker holds a grudge against. Every grudge a chain or a guess
# below needs is here, and no other.
GRUDGES = frozenset(
    {
        ("zhou_zhanggui", "li_er"),  # the bridge: the shopkeeper blames Li Er
        ("li_laotai", "zhou_dalang"),  # the elder of the other family blames the shopkeeper's son
        ("zhou_zhanggui", "shitou"),  # the lantern: the shopkeeper blames the boy Shitou
        ("li_laotai", "zhou_huoji"),  # and the elder blames the shopkeeper's clerk
    }
)
# Facts about where things are and whose they are need no one to have told the speaker.
STATIC = ("located", "owns")
# What the opening of a script shows the whole town.
HEADLINE = {
    "broken_bridge": frozenset({"pr_rail_broken"}),
    "lost_lantern": frozenset(),
    "stranger": frozenset(),
}


def grudge(kind, holder, target):
    return kind == "grudge" and (holder, target) in GRUDGES


def someone_elses(kind, holder, target):
    """A grudge held by someone else toward the same people: it must not do for the speaker."""
    return kind == "grudge" and holder == "nobody" and any(t == target for _, t in GRUDGES)


def public_of(name):
    book = BOOKS[name]
    static = {pid for pid in book.props if book.props[pid].pred in STATIC}
    return frozenset(static | HEADLINE[name])


def persons(name):
    return [e.id for e in BOOKS[name].registry.of_type("person")]


def saw(holder, prop_id, tick=10, confidence=90):
    return Belief(holder, prop_id, "assert", confidence, "saw", None, None, 0, tick, None)


def judge(name, claim, store, **kw):
    """The core's verdict on ``claim`` in script ``name``."""
    book = BOOKS[name]
    kw.setdefault("rules", book.rules)
    kw.setdefault("templates", book.templates)
    return authorize(claim, store, book.props, tables=TABLES, registry=book.registry, **kw)


def refused(verdict, code):
    ok, reason = verdict
    assert not ok and reason.startswith(code + ":"), reason


# ------------------------------------------------------------------ loading


def test_the_tables_and_the_entities_load_with_the_ladder_and_the_two_type_slots():
    assert TABLES.predicates["looked_for"].level_to == "at"
    assert TABLES.predicates["took"].heavier == "stole"
    for pred in ("damaged", "took"):
        assert TABLES.predicates[pred].slot("who").types == ("person", "family")
    assert not [p for p in TABLES.predicates if p.endswith("_by_family")]
    cast = {e["id"] for raw in RAW.values() for e in raw["entities"]}
    assert {e.id for e in ENTITIES} == cast  # the entity file is the union of the casts
    assert Tables.from_canon(TABLES.to_canon()) == TABLES


@pytest.mark.parametrize("name", SCRIPTS)
def test_a_compiled_script_loads_and_the_core_finds_nothing_wrong_with_it(name):
    book, raw = BOOKS[name], RAW[name]
    assert book.props.check(TABLES, book.registry) == []
    assert book.groups.check(book.props) == []
    assert book.problems(TABLES) == []
    # everything the compiler wrote is in the book
    assert len(book.props) == len(raw["props"])
    assert len(book.groups.groups) == len(raw["exclusive"])
    assert sorted(book.rules) == sorted(r["id"] for r in raw["speculation"])
    assert sorted(book.templates) == sorted(
        t["id"] for envelope in raw["lies"] for t in envelope["templates"]
    )
    assert [v.id for v in book.variants] == [v["id"] for v in raw["variants"]]
    assert [c.id for c in book.chains] == [c["id"] for c in raw["chains"]]
    # the script's cast is a part of the town the entity file describes
    assert all(ENTITIES.get(e.id) == e for e in book.registry)


@pytest.mark.parametrize("name", SCRIPTS)
def test_what_the_core_loads_writes_back_as_the_compiler_wrote_it(name):
    book, raw = BOOKS[name], RAW[name]
    again = book.to_canon()
    for key in again:
        if key == "props":  # a book keeps its props in id order, the file in the author's order
            assert sorted(again[key], key=lambda p: p["id"]) == sorted(
                raw[key], key=lambda p: p["id"]
            )
        else:
            assert again[key] == raw[key], key
    for rule in raw["speculation"]:
        assert SpecRule.from_canon(rule).to_canon() == rule


def test_the_props_the_core_used_to_refuse_pass_now():
    refused_before = {
        "broken_bridge": ["pr_liner_at_bridge", "pr_liner_damaged", "pr_li_damaged"],
        "lost_lantern": ["pr_zhou_took"],
    }
    for name, ids in refused_before.items():
        book = BOOKS[name]
        for pid in [*ids, "pr_li_damaged_on_purpose", "pr_li_damaged_jealous"]:
            if pid in book.props:
                assert check_prop(book.props[pid], TABLES, book.registry, book.props) == [], pid
    bridge = BOOKS["broken_bridge"].props
    assert (bridge["pr_li_damaged"].pred, bridge["pr_li_damaged"].arg("who")) == (
        "damaged",
        "fam_li",
    )
    assert bridge["pr_li_damaged_jealous"].motive == "jealousy"
    assert BOOKS["lost_lantern"].props["pr_zhou_took"].arg("who") == "fam_zhou"


# ------------------------------------------------------------------ truth


@pytest.mark.parametrize("name", SCRIPTS)
def test_each_variant_lists_the_props_and_denials_that_hold_and_no_group_holds_twice(name):
    book = BOOKS[name]
    for v in book.variants:
        assert v.true_props and all(not book.props[p].neg for p in v.true_props)
        assert all(book.props[p].neg for p in v.true_negations)
        for g in book.groups.groups:
            assert len([p for p in g.props if book.holds(v.id, p)]) <= 1, (v.id, g.id)
    first, second = book.variants[:2]
    assert set(first.true_props) != set(second.true_props)  # the variants can be told apart


@pytest.mark.parametrize("name", SCRIPTS)
def test_events_made_from_a_variant_agree_with_it_on_every_prop(name):
    """The truth a variant lists and the truth of event matching say the same about each prop."""
    book = BOOKS[name]
    for v in book.variants:
        events = [Event(f"e_{v.id}", 0, tuple(book.props[p] for p in v.true_props))]
        for pid in book.props:
            assert is_true(book.props[pid], events) == book.holds(v.id, pid), (v.id, pid)


@pytest.mark.parametrize("name", SCRIPTS)
def test_a_leveled_prop_is_true_wherever_its_parent_is(name):
    book = BOOKS[name]
    for pid in book.props:
        prop = book.props[pid]
        if prop.op == "level":
            for v in book.variants:
                if book.holds(v.id, prop.parent):
                    assert book.holds(v.id, pid), (v.id, pid)


# ------------------------------------------------------------------ the rumour chains


class Town:
    """The stores and the claim log of the people on a chain, written to the way the core will."""

    def __init__(self, name, hear_premises=False):
        self.name = name
        self.book = BOOKS[name]
        self.stores = {p: BeliefStore(p) for p in persons(name)}
        self.claims: dict[str, Claim] = {}
        self.public = public_of(name)
        self.hear_premises = hear_premises

    def claim_for(self, hop, tick):
        book = self.book
        prop = book.props[hop.prop]
        backing = self.stores[hop.speaker].get(prop.parent)
        assert backing is not None, f"{hop.speaker} holds nothing of {prop.parent} to change"
        return Claim(
            f"c{len(self.claims) + 1}",
            hop.speaker,
            (hop.listener,),
            hop.prop,
            "assert",
            backing.honest_source(),
            tick,
            "mutation",
            rule_id=hop.via,
            op=prop.op,
        )

    def verdict(self, claim, suspicion, relation=grudge, public=None):
        store = self.stores[claim.speaker]
        public = self.public if public is None else public
        return judge(self.name, claim, store, suspicion=suspicion, relation=relation, public=public)

    def say(self, claim, suspicion):
        ok, reason = self.verdict(claim, suspicion)
        assert ok, (claim.id, claim.speaker, claim.prop, reason)
        store = self.stores[claim.speaker]
        mine = speaker_belief(claim, store, self.book.props, public=self.public)
        heard = listener_belief(claim, claim.listeners[0], store, self.book.props, confidence=60)
        if mine is not None:
            store.put(mine)
        self.stores[heard.holder].put(heard)
        self.claims[claim.id] = claim


def play(name, chain, hear_premises=False):
    """Tell the chain from its root: each hop's claim is authorized before it is made."""
    town = Town(name, hear_premises)
    root, *hops = chain.hops
    first = hops[0].speaker
    town.stores[first].put(saw(first, root.prop, tick=10))
    for i, hop in enumerate(hops, start=1):
        claim = town.claim_for(hop, tick=100 * i)
        rule = town.book.rules.get(hop.via) if hop.via else None
        town.say(claim, 0 if rule is None else rule.min_suspicion)
    return town


CHAINS = [(name, chain.id) for name in SCRIPTS for chain in BOOKS[name].chains]


def chain_of(name, chain_id):
    return next(c for c in BOOKS[name].chains if c.id == chain_id)


@pytest.mark.parametrize(("name", "chain_id"), CHAINS)
def test_every_hop_of_every_chain_is_authorized_by_the_core(name, chain_id):
    chain = chain_of(name, chain_id)
    town = play(name, chain)
    assert [c.prop for c in town.claims.values()] == [h.prop for h in chain.hops[1:]]
    assert [c.op for c in town.claims.values()] == [
        town.book.props[h.prop].op for h in chain.hops[1:]
    ]
    # the last hearer's notebook walks back to the one who saw the root, one operator per hop
    last = chain.hops[-1]
    trace = walk_back(last.listener, last.prop, town.stores, town.claims, town.book.props)
    assert trace.end == "saw" and trace.origin == chain.hops[1].speaker
    assert [op for _, _, op in trace.mutations] == [c.op for c in town.claims.values()][::-1]
    assert town.book.props.lineage(last.prop) == [h.prop for h in chain.hops][::-1]


@pytest.mark.parametrize(("name", "chain_id"), CHAINS)
def test_a_hop_that_rests_on_a_rule_fails_without_the_relation_and_every_other_hop_needs_none(
    name, chain_id
):
    chain = chain_of(name, chain_id)
    town = Town(name)
    root, *hops = chain.hops
    town.stores[hops[0].speaker].put(saw(hops[0].speaker, root.prop, tick=10))
    for i, hop in enumerate(hops, start=1):
        claim = town.claim_for(hop, tick=100 * i)
        rule = town.book.rules.get(hop.via) if hop.via else None
        suspicion = 0 if rule is None else rule.min_suspicion
        assert town.verdict(claim, suspicion, relation=grudge)[0]
        without = town.verdict(claim, suspicion, relation=None)
        if rule is not None and rule.relation is not None:
            refused(without, "relation")
            # the grudge must be the speaker's own, toward the one the rule binds
            refused(town.verdict(claim, suspicion, relation=lambda *a: False), "relation")
            refused(town.verdict(claim, suspicion, relation=someone_elses), "relation")
        else:
            assert without == (True, "ok")
        town.say(claim, suspicion)


@pytest.mark.parametrize(("name", "chain_id"), CHAINS)
def test_a_hop_that_changes_the_predicate_needs_its_rule_and_the_speakers_suspicion(name, chain_id):
    chain = chain_of(name, chain_id)
    town = Town(name)
    root, *hops = chain.hops
    town.stores[hops[0].speaker].put(saw(hops[0].speaker, root.prop, tick=10))
    for i, hop in enumerate(hops, start=1):
        claim = town.claim_for(hop, tick=100 * i)
        rule = town.book.rules.get(hop.via) if hop.via else None
        if rule is not None:
            refused(town.verdict(claim, rule.min_suspicion - 1), "suspicion")
            refused(town.verdict(claim, rule.min_suspicion, public=frozenset()), "premises")
            unnamed = Claim(
                **{
                    **claim.to_canon(),
                    "rule_id": None,
                    "listeners": claim.listeners,
                    "premises": (),
                }
            )
            refused(town.verdict(unnamed, rule.min_suspicion), "extras")
        else:
            named = Claim(
                **{
                    **claim.to_canon(),
                    "rule_id": next(iter(town.book.rules), "x"),
                    "listeners": claim.listeners,
                    "premises": (),
                }
            )
            refused(town.verdict(named, 99), "extras")
        town.say(claim, 0 if rule is None else rule.min_suspicion)


def test_a_rule_may_rest_on_what_the_speaker_holds_instead_of_what_the_town_knows():
    name = "broken_bridge"
    chain = chain_of(name, "ch_li_er_rumor")
    town = Town(name)
    root, first, second, *_ = chain.hops
    town.stores[first.speaker].put(saw(first.speaker, root.prop, tick=10))
    town.say(town.claim_for(first, 100), 0)
    # the shopkeeper now holds that the rail is at the bridge and broken, and the town says nothing
    for pid in ("pr_rail_located", "pr_rail_broken"):
        town.stores[second.speaker].put(saw(second.speaker, pid, tick=20))
    claim = town.claim_for(second, 200)
    rule = town.book.rules[second.via]
    assert town.verdict(claim, rule.min_suspicion, public=frozenset())[0]
    refused(town.verdict(claim, rule.min_suspicion - 1, public=frozenset()), "suspicion")
    # a premise learnt after the claim does not count
    late = Town(name)
    late.stores[first.speaker].put(saw(first.speaker, root.prop, tick=10))
    late.say(late.claim_for(first, 100), 0)
    late.stores[second.speaker].put(saw(second.speaker, "pr_rail_located", tick=500))
    late.stores[second.speaker].put(saw(second.speaker, "pr_rail_broken", tick=500))
    refused(
        late.verdict(late.claim_for(second, 200), rule.min_suspicion, public=frozenset()),
        "premises",
    )


def test_the_chains_use_every_clause_of_every_operator():
    seen = set()
    for name in SCRIPTS:
        book = BOOKS[name]
        for chain in book.chains:
            for hop in chain.hops[1:]:
                prop = book.props[hop.prop]
                parent = book.props[prop.parent]
                changed = prop.pred != parent.pred
                if prop.op == "level":
                    seen.add("level_to" if changed else "level_drop")
                elif prop.op == "sharpen":
                    seen.add("heavier" if changed else "on_purpose")
                elif prop.op == "assimilate":
                    if changed:
                        seen.add("rule")
                    else:
                        swapped = [s for s, e in prop.args if parent.arg(s) != e]
                        seen.add(book.registry.type_of(prop.arg(swapped[0])))
                else:
                    seen.add("fill_from_on_purpose" if parent.motive else "fill_from_none")
    assert seen == {
        "level_to",
        "level_drop",
        "heavier",
        "on_purpose",
        "rule",
        "family",
        "person",
        "fill_from_none",
        "fill_from_on_purpose",
    }


# ------------------------------------------------------------------ lies


def all_templates():
    return [
        (name, envelope.holder, t.id)
        for name in SCRIPTS
        for envelope in BOOKS[name].lies
        for t in envelope.templates
    ]


@pytest.mark.parametrize(("name", "holder", "template_id"), all_templates())
def test_a_lie_template_authorizes_for_its_holder_and_fails_for_every_other_speaker(
    name, holder, template_id
):
    book = BOOKS[name]
    template = book.templates[template_id]
    assert template.holder == holder
    others = [p for p in persons(name) if p != holder]
    assert others
    if template.kind == "feign_ignorance":
        assert authorize_ignorance(holder, template_id, book.templates) == (True, "ok")
        assert template.about in TABLES.predicates
        for other in others:
            refused(authorize_ignorance(other, template_id, book.templates), "template_speaker")
        return

    def lie(speaker, listener, **change):
        base = {
            "id": "c1",
            "speaker": speaker,
            "listeners": (listener,),
            "prop": template.prop,
            "modality": "lie",
            "claimed_source": template.claimed_source,
            "tick": 100,
            "path": "lie",
            "template_id": template_id,
        }
        return Claim(**{**base, **change})

    claim = lie(holder, others[0])
    store = BeliefStore(holder)
    assert judge(name, claim, store) == (True, "ok")
    for other in others:
        liar = lie(other, holder)
        refused(judge(name, liar, BeliefStore(other)), "template_speaker")
    # the prop and the source are the template's own
    stray = next(p for p in book.props if p != template.prop)
    refused(judge(name, lie(holder, others[0], prop=stray), store), "template_prop")
    wrong = next(s for s in ("self_seen", "unknown", others[0]) if s != template.claimed_source)
    refused(judge(name, lie(holder, others[0], claimed_source=wrong), store), "template_source")
    # a lie is heard as an assertion, the liar notes it, and the trace of it ends there
    listener = others[0]
    heard = listener_belief(claim, listener, store, book.props, confidence=55)
    assert (heard.modality, heard.claimed_source, heard.hop) == (
        "assert",
        template.claimed_source,
        1,
    )
    assert [(n.prop, n.listener) for n in lie_notes(claim)] == [(template.prop, listener)]
    stores = {holder: store, listener: BeliefStore(listener, [heard])}
    trace = walk_back(listener, template.prop, stores, {claim.id: claim}, book.props)
    assert (trace.end, trace.origin) == ("lie", holder)


def test_the_lie_that_names_a_false_source_for_a_true_prop_is_still_a_lie():
    book = BOOKS["broken_bridge"]
    template = book.templates["lie_zhang_saw_liner"]
    assert template.source_only and template.prop == "pr_liner_at_bridge"
    assert all(book.holds(v.id, template.prop) for v in book.variants)  # the prop is true
    assert template.claimed_source == "self_seen"  # he did not see it, he heard it from the clerk


# ------------------------------------------------------------------ guesses


def brute_force_bindings(name, rule):
    """Every way the premises can be filled with positive props, by plain dictionary logic.

    Where the rule asks for a relation, the one it binds must belong to a family: grudges are
    between families, and a bystander such as the watchman has none to hold or to bear.
    """
    book = BOOKS[name]
    pool = [book.props[p] for p in book.props if not book.props[p].neg]
    kinds = dict(rule.vars)
    found = []
    for combo in itertools.product(*[[p for p in pool if p.pred == q.pred] for q in rule.premises]):
        env, ok = {}, True
        for pattern, prop in zip(rule.premises, combo, strict=True):
            for slot, term in pattern.args:
                actual = prop.arg(slot)
                if actual is None:
                    ok = False
                elif not term.startswith("$"):
                    ok = ok and term == actual
                else:
                    ok = ok and env.setdefault(term[1:], actual) == actual
                    ok = ok and book.registry.type_of(actual) == kinds[term[1:]]
        if ok and rule.relation is not None:
            target = book.registry.get(env[rule.relation.target[1:]])
            ok = target is not None and target.family is not None
        if ok:
            found.append((tuple(p.id for p in combo), env))
    return found


def engine_bindings(name, rule):
    """The same, found by the rule's own matching."""
    book = BOOKS[name]
    pool = [book.props[p] for p in book.props if not book.props[p].neg]
    found = []

    def fill(i, env, matched):
        if i == len(rule.premises):
            found.append((tuple(matched), env))
            return
        for prop in pool:
            nxt = rule.bind(i, prop, env, book.registry)
            if nxt is not None:
                fill(i + 1, nxt, [*matched, prop.id])

    fill(0, {}, [])
    if rule.relation is not None:
        found = [
            (m, e)
            for m, e in found
            if book.registry.get(e[rule.relation.target[1:]]).family is not None
        ]
    return found


def conclusion_of(name, rule, env):
    book = BOOKS[name]
    wanted = {s: (env[t[1:]] if t.startswith("$") else t) for s, t in rule.conclusion.args}
    return [
        pid
        for pid in book.props
        if book.props[pid].pred == rule.conclusion.pred
        and not book.props[pid].neg
        and all(book.props[pid].arg(s) == e for s, e in wanted.items())
    ]


BINDINGS = [
    (name, rule_id, index)
    for name in SCRIPTS
    for rule_id, rule in BOOKS[name].rules.items()
    for index in range(len(brute_force_bindings(name, rule)))
]


@pytest.mark.parametrize("name", SCRIPTS)
def test_the_rules_own_matching_finds_the_bindings_that_plain_enumeration_finds(name):
    book = BOOKS[name]
    for rule in book.rules.values():
        plain = brute_force_bindings(name, rule)
        assert plain, rule.id
        assert sorted(plain, key=repr) == sorted(engine_bindings(name, rule), key=repr), rule.id
        for _, env in plain:
            assert conclusion_of(name, rule, env), (rule.id, env)  # each lands on an authored prop


def test_there_are_bindings_to_try():
    assert len(BINDINGS) == 17  # 5 + 7 + 5, as the checker's report counts them
    assert {rule for _, rule, _ in BINDINGS} >= {"sr_presence_grudge", "sr_rival_spite"}


@pytest.mark.parametrize(("name", "rule_id", "index"), BINDINGS)
def test_every_binding_the_content_lists_authorizes_when_its_premises_are_held(
    name, rule_id, index
):
    book = BOOKS[name]
    rule = book.rules[rule_id]
    premises, env = brute_force_bindings(name, rule)[index]
    conclusion = conclusion_of(name, rule, env)[0]
    public = public_of(name)
    if rule.relation is None:
        speaker = "gengfu"
    else:
        target = env[rule.relation.target[1:]]
        holders = [h for h, t in sorted(GRUDGES) if t == target and h in persons(name)]
        assert holders, f"the test spells out no grudge toward {target}"
        speaker = holders[0]
    listener = next(p for p in persons(name) if p != speaker)
    held = [saw(speaker, pid) for pid in premises if pid not in public]
    store = BeliefStore(speaker, held)
    claim = Claim(
        "c1",
        speaker,
        (listener,),
        conclusion,
        "speculate",
        speaker,
        100,
        "speculation",
        rule_id=rule_id,
        premises=premises,
    )

    def verdict(store=store, claim=claim, **kw):
        kw.setdefault("suspicion", rule.min_suspicion)
        kw.setdefault("relation", grudge)
        kw.setdefault("public", public)
        return judge(name, claim, store, **kw)

    assert verdict() == (True, "ok")
    # the guess is recorded as the speaker's own, and the listener hears it as the speaker's guess
    mine = speaker_belief(claim, store, book.props, public=public)
    theirs = listener_belief(claim, listener, store, book.props, confidence=40)
    assert (mine.modality, mine.source) == ("speculate", "inferred")
    assert (theirs.modality, theirs.teller, theirs.claimed_source) == (
        "speculate",
        speaker,
        speaker,
    )
    stores = {
        speaker: BeliefStore(speaker, [*held, mine]),
        listener: BeliefStore(listener, [theirs]),
    }
    trace = walk_back(listener, conclusion, stores, {claim.id: claim}, book.props)
    assert (trace.end, trace.origin) == ("inferred", speaker)

    # what the rule asks for is each thing it asks for
    def changed(**change):
        return Claim(
            **{**claim.to_canon(), "listeners": claim.listeners, "premises": premises, **change}
        )

    if rule.min_suspicion:
        refused(verdict(suspicion=rule.min_suspicion - 1), "suspicion")
    if rule.relation is not None:
        refused(verdict(relation=None), "relation")
        refused(verdict(relation=lambda *a: False), "relation")
    if held:
        refused(verdict(store=BeliefStore(speaker, held[1:])), "premises")
    if len(premises) > 1:
        refused(verdict(claim=changed(premises=premises[::-1])), "premises")  # out of order
    refused(verdict(claim=changed(modality="assert")), "modality")  # a guess is said as a guess
    refused(verdict(claim=changed(rule_id="made_up")), "unknown_rule")
    stray = next(p for p in book.props if p not in (conclusion, *premises))
    refused(verdict(claim=changed(prop=stray)), "conclusion")


def test_the_relation_the_content_asks_for_is_a_grudge_of_the_speaker():
    kinds = {
        (name, r.id, r.relation.kind, r.relation.holder)
        for name in SCRIPTS
        for r in BOOKS[name].rules.values()
        if r.relation is not None
    }
    assert kinds == {
        ("broken_bridge", "sr_presence_grudge", "grudge", "speaker"),
        ("lost_lantern", "sr_rival_spite", "grudge", "speaker"),
    }
