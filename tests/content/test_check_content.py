"""The content passes the build-time checker, its compiled files are fresh, and broken inputs fail.

The rejection tests edit the parsed YAML in memory and run ``validate``, so nothing is written
except in the two tests that exercise ``--check`` against a copy of the content.
"""

from __future__ import annotations

import copy
import json
import random
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

import check_content as cc
from lantern_core import canon

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ["broken_bridge", "lost_lantern", "stranger"]
BASE = cc.load_sources(ROOT)


def check(mutate: Callable[[cc.Sources], None]) -> list[str]:
    """Apply ``mutate`` to a copy of the parsed sources and return the errors."""
    src = copy.deepcopy(BASE)
    mutate(src)
    return cc.validate(src).errors


def prop(src: cc.Sources, script: str, prop_id: str) -> dict[str, Any]:
    return next(p for p in src.scripts[script]["props"] if p["id"] == prop_id)


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


# --- the repository content ----------------------------------------------------------------


def test_content_passes() -> None:
    report = cc.validate(copy.deepcopy(BASE))
    assert report.errors == []
    assert set(report.outputs) == {
        "tables.json",
        "entities.json",
        "sentences.json",
        "speech.json",
        "voices.json",
        "prompts.json",
        "map_bridge_town.json",
        "cast_bridge_v0.json",
        *(f"{s}.json" for s in SCRIPTS),
    }
    assert set(report.generated) == {
        "core/lantern_core/world/bridge/data.py",
        "core/lantern_core/world/bridge/prompt_data.py",
        "core/lantern_core/world/bridge/sentences.py",
        "core/lantern_core/world/bridge/speech_data.py",
        "core/lantern_core/world/bridge/voice_data.py",
    }


def test_compiled_files_are_up_to_date() -> None:
    report = cc.validate(copy.deepcopy(BASE))
    assert cc.stale_files(ROOT, report.outputs) == []
    assert cc.stale_generated(ROOT, report.generated) == []


# Predicates that no script uses because the town makes them in play: what it comes to say of
# the festival manager when they lie or break their word.
MADE_IN_PLAY = {"lied", "broke_promise"}


def test_every_table_entry_is_used() -> None:
    report = cc.validate(copy.deepcopy(BASE))
    prefix = "tables: predicates nobody uses: "
    (line,) = (line for line in report.coverage if line.startswith(prefix))
    assert set(line.removeprefix(prefix).split(", ")) == MADE_IN_PLAY
    assert "tables: motives nobody uses: none" in report.coverage
    assert "entities: in no script: none" in report.coverage


def test_each_script_has_three_or_more_variants_with_distinguishing_sets() -> None:
    for name in SCRIPTS:
        data = json.loads((ROOT / "content" / "compiled" / f"{name}.json").read_text("utf-8"))
        assert len(data["variants"]) >= 3
        for v in data["variants"]:
            sets = [s for s in data["evidence_sets"] if s["tells"] == v["id"]]
            assert 1 <= len(sets) <= cc.MAX_SETS_PER_VARIANT


def test_compiled_files_are_canonical() -> None:
    for path in sorted((ROOT / "content" / "compiled").glob("*.json")):
        raw = path.read_bytes()
        assert canon.dumps(canon.loads(raw)) == raw, path.name


def test_tables_json_matches_the_contract() -> None:
    """Contract v2: a slot's type is one type or a list of them, and a predicate has a ladder."""
    data = json.loads((ROOT / "content" / "compiled" / "tables.json").read_text("utf-8"))
    assert set(data) == {"predicates", "motives"}
    ids = {p["id"] for p in data["predicates"]}
    for p in data["predicates"]:
        assert set(p) == {"id", "label", "slots", "level_to", "heavier"}
        assert p["level_to"] in ids | {None} and p["heavier"] in ids | {None}
        for s in p["slots"]:
            assert set(s) == {"name", "type", "required"}
            types = [s["type"]] if isinstance(s["type"], str) else s["type"]
            assert types and len(set(types)) == len(types)
            assert set(types) <= {"person", "family", "thing", "place"}
            assert isinstance(s["type"], str) or len(types) > 1  # one type is written bare
    assert all(set(m) == {"id", "label"} for m in data["motives"])
    by_id = {p["id"]: p for p in data["predicates"]}
    at = by_id["at"]
    assert [(s["type"], s["required"]) for s in at["slots"]] == [("person", True), ("place", True)]
    assert (by_id["looked_for"]["level_to"], by_id["took"]["heavier"]) == ("at", "stole")
    assert {p for p in by_id if p.endswith("_by_family")} == set()  # a family is a kind of actor
    for pred in ("damaged", "took"):
        assert by_id[pred]["slots"][0] == {
            "name": "who",
            "type": ["person", "family"],
            "required": True,
        }


def test_entities_json_matches_the_contract() -> None:
    data = json.loads((ROOT / "content" / "compiled" / "entities.json").read_text("utf-8"))
    for e in data["entities"]:
        assert e["type"] in {"person", "family", "thing", "place"}
        want = {"id", "type", "label", "label_en"}
        assert set(e) == want | ({"family"} if e["type"] == "person" else set())
        assert e["label_en"].strip() and e["label_en"].isascii()  # the English name is plain ASCII


@pytest.mark.parametrize("name", SCRIPTS)
def test_script_json_matches_the_contract(name: str) -> None:
    data = json.loads((ROOT / "content" / "compiled" / f"{name}.json").read_text("utf-8"))
    tables = json.loads((ROOT / "content" / "compiled" / "tables.json").read_text("utf-8"))
    preds = {p["id"]: p for p in tables["predicates"]}
    ents = {e["id"]: e for e in data["entities"]}
    ids = {p["id"] for p in data["props"]}
    assert len(ids) == len(data["props"])
    for p in data["props"]:
        assert set(p) - {"parent", "op"} == {"id", "pred", "args", "span", "neg", "motive"}
        assert ("parent" in p) == ("op" in p)
        assert p["span"] is None or (len(p["span"]) == 2 and p["span"][0] <= p["span"][1])
        for slot in preds[p["pred"]]["slots"]:
            if slot["required"]:
                types = [slot["type"]] if isinstance(slot["type"], str) else slot["type"]
                assert ents[p["args"][slot["name"]]]["type"] in types
        if "parent" in p:
            assert p["parent"] in ids
            assert p["op"] in {"level", "sharpen", "assimilate", "fill"}
    for g in data["exclusive"]:
        assert set(g) == {"id", "props"} and set(g["props"]) <= ids
    neg = {p["id"] for p in data["props"] if p["neg"]}
    for v in data["variants"]:
        assert set(v) == {"id", "label", "true_props", "true_negations"}
        assert set(v["true_props"]) <= ids - neg  # events state what happened, never a negation
        assert set(v["true_negations"]) <= neg
    assert 0 <= data["truth_fixed_at"] <= data["days"] * 1440


def test_a_level_step_is_true_wherever_its_parent_is() -> None:
    def true_props(name: str, variant: str) -> set[str]:
        path = ROOT / "content" / "compiled" / f"{name}.json"
        data = json.loads(path.read_text("utf-8"))
        return set(next(v for v in data["variants"] if v["id"] == variant)["true_props"])

    assert "pr_wanted_bare" in true_props("stranger", "v_fugitive")
    assert "pr_wanted_bare" not in true_props("stranger", "v_swindler")
    assert "pr_kid_took_bare" in true_props("lost_lantern", "v_child")
    assert "pr_kid_took_bare" not in true_props("lost_lantern", "v_apprentice")
    assert "pr_wanted_greed" not in true_props("stranger", "v_fugitive")  # fill is not entailed


def test_broken_bridge_has_the_four_operators_and_the_ending_table() -> None:
    data = json.loads((ROOT / "content" / "compiled" / "broken_bridge.json").read_text("utf-8"))
    assert {p["op"] for p in data["props"] if "op" in p} == {
        "level",
        "sharpen",
        "assimilate",
        "fill",
    }
    assert [r["label"] for r in data["endings"]["rows"]][:2] == ["圆满", "勉强"]
    assert len(data["hard_conditions"][0]["any"]) == 3


def test_stale_and_missing_compiled_files_fail_the_check(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "content", tmp_path / "content")
    module = tmp_path / "core" / "lantern_core" / "world" / "bridge" / "data.py"
    module.parent.mkdir(parents=True)
    names = ("data.py", "prompt_data.py", "sentences.py", "speech_data.py")
    for name in (*names, "voice_data.py", "phrases.py"):
        shutil.copy(
            ROOT / "core" / "lantern_core" / "world" / "bridge" / name, module.with_name(name)
        )
    assert cc.main(["--check", "--quiet", "--root", str(tmp_path)]) == 0
    module.write_bytes(module.read_bytes() + b"# edited by hand\n")
    assert cc.stale_generated(tmp_path, cc.validate(cc.load_sources(tmp_path)).generated) == [
        "core/lantern_core/world/bridge/data.py: out of date"
    ]
    assert cc.main(["--check", "--quiet", "--root", str(tmp_path)]) == 1
    assert cc.main(["--quiet", "--root", str(tmp_path)]) == 0  # the tool writes the module back
    assert cc.main(["--check", "--quiet", "--root", str(tmp_path)]) == 0
    compiled = tmp_path / "content" / "compiled"
    (compiled / "stranger.json").write_bytes(b"{}")
    (compiled / "lost_lantern.json").unlink()
    (compiled / "extra.json").write_bytes(b"{}")
    report = cc.validate(cc.load_sources(tmp_path))
    stale = cc.stale_files(tmp_path, report.outputs)
    assert "stranger.json: out of date" in stale
    assert "lost_lantern.json: missing" in stale
    assert "extra.json: no longer produced" in stale
    assert cc.main(["--check", "--quiet", "--root", str(tmp_path)]) == 1
    assert cc.main(["--quiet", "--root", str(tmp_path)]) == 0  # rewriting fixes it
    assert cc.main(["--check", "--quiet", "--root", str(tmp_path)]) == 0


# --- tables and entities ---------------------------------------------------------------------


def test_unknown_predicate_is_rejected() -> None:
    errors = check(lambda s: prop(s, "broken_bridge", "pr_boat_damaged").update(pred="smashed"))
    assert has(errors, "broken_bridge", "pr_boat_damaged", "unknown predicate 'smashed'")


def test_wrong_argument_type_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        prop(s, "broken_bridge", "pr_boat_damaged")["args"]["who"] = "p_bridge"

    errors = check(mutate)
    assert has(errors, "pr_boat_damaged", "slot 'who' of 'damaged' expects a person", "p_bridge")


def test_missing_required_slot_and_unknown_slot_are_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        del prop(s, "broken_bridge", "pr_boat_damaged")["args"]["what"]
        prop(s, "broken_bridge", "pr_flood_damaged")["args"]["who"] = "old_he"

    errors = check(mutate)
    assert has(errors, "pr_boat_damaged", "needs slot 'what'")
    assert has(errors, "pr_flood_damaged", "has no slot 'who'")


def test_unknown_motive_and_unknown_entity_are_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        prop(s, "broken_bridge", "pr_boat_damaged")["motive"] = "boredom"
        prop(s, "broken_bridge", "pr_flood_damaged")["args"]["what"] = "t_nothing"

    errors = check(mutate)
    assert has(errors, "pr_boat_damaged", "unknown motive 'boredom'")
    assert has(errors, "pr_flood_damaged", "unknown entity 't_nothing'")


def test_entity_not_in_the_cast_is_rejected() -> None:
    errors = check(lambda s: s.scripts["broken_bridge"]["cast"].remove("old_he"))
    assert has(errors, "'old_he' is used but not listed in cast")


def test_person_without_family_in_the_cast_is_rejected() -> None:
    errors = check(lambda s: s.scripts["broken_bridge"]["cast"].remove("fam_li"))
    assert has(errors, "belongs to 'fam_li', which must be in the cast too")


def test_table_errors_are_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        s.predicates["predicates"][1]["id"] = "at"
        s.motives["motives"].append({"id": "accident", "label": "意外"})
        s.entities["people"][0]["family"] = "fam_nobody"

    errors = check(mutate)
    assert has(errors, "predicates.yaml", "duplicate predicate 'at'")
    assert has(errors, "motives.yaml", "duplicate motive 'accident'")
    assert has(errors, "entities.yaml", "unknown family 'fam_nobody'")


def test_at_must_exist() -> None:
    def mutate(s: cc.Sources) -> None:
        s.predicates["predicates"] = [p for p in s.predicates["predicates"] if p["id"] != "at"]

    assert has(check(mutate), "must define 'at'")


def pred(src: cc.Sources, pred_id: str) -> dict[str, Any]:
    return next(p for p in src.predicates["predicates"] if p["id"] == pred_id)


@pytest.mark.parametrize(
    ("mutate", "needles"),
    [
        (lambda s: pred(s, "damaged")["slots"][0].update(type=[]), ("damaged.who", "one or more")),
        (
            lambda s: pred(s, "damaged")["slots"][0].update(type=["person", "person"]),
            ("damaged.who", "different types"),
        ),
        (lambda s: pred(s, "damaged")["slots"][0].update(type=["person", "ghost"]), ("type",)),
        (
            lambda s: pred(s, "at")["slots"][0].update(type=["person", "family"]),
            ("'at' must start",),
        ),
        (lambda s: pred(s, "looked_for").update(level_to="nowhere"), ("level_to", "nowhere")),
        (lambda s: pred(s, "looked_for").update(level_to="looked_for"), ("level_to",)),
        (lambda s: pred(s, "took").update(heavier="at"), ("took.heavier", "same slot names")),
        (lambda s: pred(s, "at").update(level_to="gave"), ("at.level_to", "also needs")),
    ],
)
def test_a_broken_ladder_or_slot_type_in_the_table_is_rejected(
    mutate: Callable[[cc.Sources], None], needles: tuple[str, ...]
) -> None:
    assert has(check(mutate), "predicates.yaml", *needles)


def test_the_compiled_table_writes_one_type_bare_and_several_as_a_list() -> None:
    report = cc.validate(copy.deepcopy(BASE))
    data = json.loads(report.outputs["tables.json"])
    by_id = {p["id"]: p for p in data["predicates"]}
    assert by_id["damaged"]["slots"][0]["type"] == ["person", "family"]
    assert by_id["damaged"]["slots"][1]["type"] == "thing"
    one_in_a_list = check(lambda s: pred(s, "wanted")["slots"][0].update(type=["person"]))
    assert one_in_a_list == []  # written either way, compiled the same
    same = cc.validate(copy.deepcopy(BASE)).outputs["tables.json"]
    src = copy.deepcopy(BASE)
    pred(src, "wanted")["slots"][0]["type"] = ["person"]
    assert cc.validate(src).outputs["tables.json"] == same


def test_the_core_reads_the_compiled_tables_with_their_ladder() -> None:
    from lantern_core.cognition.props import Tables

    tables = Tables.loads((ROOT / "content" / "compiled" / "tables.json").read_bytes())
    assert tables.predicates["looked_for"].level_to == "at"
    assert tables.predicates["took"].heavier == "stole"
    assert tables.predicates["damaged"].slot("who").types == ("person", "family")


def test_a_rule_variable_may_be_a_person_where_the_slot_takes_a_person_or_a_family() -> None:
    assert check(lambda s: None) == []  # sr_presence_grudge: $X is a person for damaged.who

    def mutate(s: cc.Sources) -> None:
        rule = next(
            r for r in s.scripts["broken_bridge"]["speculation"] if r["id"] == "sr_flood_season"
        )
        rule["premises"].append({"pred": "damaged", "args": {"who": "$T", "what": "$T"}})

    assert has(check(mutate), "sr_flood_season", "variable $T is a thing", "person or family")


# --- truth variants and evidence -------------------------------------------------------------


def test_variant_without_distinguishing_evidence_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        sets = s.scripts["broken_bridge"]["evidence_sets"]
        sets[:] = [e for e in sets if e["tells"] != "v_flood"]

    errors = check(mutate)
    assert has(errors, "broken_bridge", "variant v_flood has no evidence set that tells it apart")


def test_evidence_set_that_cannot_rule_out_a_rival_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        # the scratches exist in both v_boat and v_flood, so they alone cannot tell them apart
        s.scripts["broken_bridge"]["evidence_sets"] = [
            {"id": "es_x", "tells": "v_boat", "items": ["e_boat_scratches"]}
        ]

    errors = check(mutate)
    assert has(errors, "es_x", "tells v_boat but does not rule out v_flood")


def test_evidence_set_with_an_item_that_cannot_exist_in_its_variant_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        sets = s.scripts["broken_bridge"]["evidence_sets"]
        next(e for e in sets if e["id"] == "es_drunk_1")["items"] = ["e_xiaoman_testimony"]

    errors = check(mutate)
    assert has(errors, "es_drunk_1", "e_xiaoman_testimony", "cannot exist in v_drunk")


def test_set_and_item_limits_are_enforced() -> None:
    def mutate(s: cc.Sources) -> None:
        sc = s.scripts["lost_lantern"]
        items = ["e_dorm_mate", "e_granny_home", "e_tea_owner", "e_maker_loft", "e_flaw"]
        sc["evidence_sets"].append({"id": "es_big", "tells": "v_maker", "items": items})

    assert has(check(mutate), "es_big", "at most 4 different items")


def test_two_identical_variants_are_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        sc = s.scripts["stranger"]
        sc["variants"][1]["holds"] = list(sc["variants"][0]["holds"])

    assert has(check(mutate), "have the same truth")


def test_exclusive_group_violation_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        s.scripts["broken_bridge"]["variants"][0]["holds"].append("pr_flood_damaged")

    errors = check(mutate)
    assert has(errors, "exclusive group x_cause", "variant v_boat makes", "true together")


def test_evidence_that_supports_a_prop_true_nowhere_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        ev = next(e for e in s.scripts["broken_bridge"]["evidence"] if e["id"] == "e_footprint")
        ev["supports"] = ["pr_liner_damaged"]

    assert has(check(mutate), "evidence e_footprint", "cannot exist in any variant")


def test_observation_that_misleads_toward_a_truth_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        ob = next(
            o for o in s.scripts["broken_bridge"]["observations"] if o["id"] == "obs_watermark"
        )
        ob["toward"] = ["pr_flooded"]

    assert has(check(mutate), "obs_watermark", "true wherever it is seen")


def test_negated_prop_listed_by_hand_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        s.scripts["broken_bridge"]["variants"][0]["holds"].append("pr_dalang_not_bridge")

    assert has(check(mutate), "negation of a stated prop", "derived")


# --- mutations -------------------------------------------------------------------------------


def test_mutated_prop_needs_parent_and_op_together() -> None:
    def mutate(s: cc.Sources) -> None:
        del prop(s, "broken_bridge", "pr_li_damaged")["op"]

    assert has(check(mutate), "pr_li_damaged", "needs both parent and op")


def test_unknown_parent_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        prop(s, "broken_bridge", "pr_li_damaged")["parent"] = "pr_nowhere"

    assert has(check(mutate), "parent 'pr_nowhere' does not exist")


@pytest.mark.parametrize(
    ("prop_id", "op", "needle"),
    [
        ("pr_li_damaged_on_purpose", "level", "the motive may be kept or dropped"),
        ("pr_li_damaged_jealous", "sharpen", "sharpen raises the predicate a rung"),
        ("pr_li_damaged", "sharpen", "sharpen keeps the arguments"),
        ("pr_liner_at_bridge", "fill", "fill changes nothing but the motive"),
        ("pr_li_damaged_on_purpose", "assimilate", "assimilate keeps the span"),
    ],
)
def test_illegal_operator_step_is_rejected(prop_id: str, op: str, needle: str) -> None:
    errors = check(lambda s: prop(s, "broken_bridge", prop_id).update(op=op))
    assert has(errors, prop_id, f"{op} step", "illegal", needle)


def test_assimilate_to_the_wrong_family_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        prop(s, "broken_bridge", "pr_li_damaged")["args"]["who"] = "fam_zhou"

    assert has(check(mutate), "pr_li_damaged", "'fam_zhou' is not the family of 'li_er'")


def test_assimilate_may_swap_a_person_for_a_family_and_a_person_for_a_person() -> None:
    assert check(lambda s: None) == []  # pr_li_damaged is the first, pr_liner_stole the second


def test_a_slot_that_takes_two_types_names_both_when_it_refuses_a_third() -> None:
    def mutate(s: cc.Sources) -> None:
        prop(s, "broken_bridge", "pr_li_damaged")["args"]["who"] = "t_rail"

    assert has(check(mutate), "pr_li_damaged", "expects a person or family", "'t_rail'")


def test_predicate_change_needs_a_licensing_rule() -> None:
    def mutate(s: cc.Sources) -> None:
        for hop in s.scripts["broken_bridge"]["chains"][0]["hops"]:
            hop.pop("via", None)

    assert has(check(mutate), "pr_liner_damaged", "needs a speculation rule")


def test_the_rule_named_for_a_step_must_really_make_it() -> None:
    def mutate(s: cc.Sources) -> None:
        hops = s.scripts["broken_bridge"]["chains"][0]["hops"]
        next(h for h in hops if h.get("via"))["via"] = "sr_flood_season"

    assert has(check(mutate), "pr_liner_damaged", "assimilate step", "illegal")


def test_level_may_drop_nothing_and_may_not_widen_a_span() -> None:
    def keeps_all(s: cc.Sources) -> None:
        root = prop(s, "broken_bridge", "pr_liner_looking")
        s.scripts["broken_bridge"]["props"].append(
            {**root, "id": "pr_liner_looking_again", "parent": "pr_liner_looking", "op": "level"}
        )

    assert check(keeps_all) == []

    def widens(s: cc.Sources) -> None:
        prop(s, "stranger", "pr_wanted_bare")["span"] = [-2000, 10080]

    assert has(check(widens), "pr_wanted_bare", "level step", "kept or dropped")


def test_fill_needs_a_concrete_motive() -> None:
    # pr_li_damaged_jealous fills pr_li_damaged_on_purpose, which the content passes unchanged
    errors = check(
        lambda s: prop(s, "broken_bridge", "pr_li_damaged_jealous").update(motive="accident")
    )
    assert has(errors, "pr_li_damaged_jealous", "fill step", "concrete motive")


def test_sharpen_may_turn_an_accident_into_on_purpose() -> None:
    def mutate(s: cc.Sources) -> None:
        # pr_boat_damaged is an accident: a sharpened copy of it says it was on purpose
        s.scripts["broken_bridge"]["props"].append(
            {**prop(s, "broken_bridge", "pr_boat_damaged"), "id": "pr_boat_on_purpose"}
            | {"motive": "on_purpose", "parent": "pr_boat_damaged", "op": "sharpen"}
        )

    assert check(mutate) == []


def test_chain_hops_must_follow_the_parent_links() -> None:
    def mutate(s: cc.Sources) -> None:
        hops = s.scripts["broken_bridge"]["chains"][0]["hops"]
        hops[2], hops[3] = hops[3], hops[2]

    assert has(check(mutate), "chain ch_li_er_rumor", "expects")


# --- lies and speculation --------------------------------------------------------------------


def test_lie_outside_the_allowed_predicates_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        lh = next(x for x in s.scripts["broken_bridge"]["lies"] if x["holder"] == "old_he")
        lh["templates"].append(
            {
                "id": "lie_he_blames",
                "kind": "claim",
                "prop": "pr_dalang_damaged",
                "source": {"kind": "witnessed"},
            }
        )

    errors = check(mutate)
    assert has(
        errors, "lie template lie_he_blames", "may not claim 'damaged'", "allowed predicates"
    )
    assert has(errors, "lie template lie_he_blames", "may not name 'zhou_dalang'")


def test_lie_with_a_source_outside_the_envelope_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        lh = next(x for x in s.scripts["broken_bridge"]["lies"] if x["holder"] == "old_he")
        lh["templates"][0]["source"] = {"kind": "gossip"}

    assert has(check(mutate), "lie_he_home", "may not claim the source 'gossip'")


def test_feigned_ignorance_outside_the_envelope_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        lh = next(x for x in s.scripts["broken_bridge"]["lies"] if x["holder"] == "old_he")
        lh["ignorance"] = []

    assert has(check(mutate), "lie_he_ignorant", "may not feign ignorance")


def test_a_claim_that_is_true_everywhere_is_no_lie() -> None:
    def mutate(s: cc.Sources) -> None:
        lh = next(x for x in s.scripts["broken_bridge"]["lies"] if x["holder"] == "zhou_zhanggui")
        lh["templates"][1].pop("source_only")

    assert has(check(mutate), "lie_zhang_saw_liner", "is true in every variant", "no lie")


def test_speculation_rule_with_a_type_error_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        rule = next(
            r for r in s.scripts["broken_bridge"]["speculation"] if r["id"] == "sr_flood_season"
        )
        rule["vars"]["P"] = "thing"

    assert has(check(mutate), "sr_flood_season", "variable $P is a thing", "wants a place")


def test_speculation_rule_must_conclude_something_the_script_states() -> None:
    def mutate(s: cc.Sources) -> None:
        sc = s.scripts["broken_bridge"]
        sc["props"] = [p for p in sc["props"] if p["id"] != "pr_flood_damaged"]
        sc["variants"][1]["holds"].remove("pr_flood_damaged")
        sc["evidence"] = [
            e for e in sc["evidence"] if e["id"] not in ("e_flood_debris", "e_gengfu_flood")
        ]
        sc["evidence_sets"] = [x for x in sc["evidence_sets"] if x["tells"] != "v_flood"]
        sc["exclusive"] = [
            g for g in sc["exclusive"] if not g["id"].startswith("x_rumor") and g["id"] != "x_cause"
        ]
        sc["observations"] = [o for o in sc["observations"] if o["id"] != "obs_watermark"]

    assert has(check(mutate), "sr_flood_season", "flood_damaged", "no prop of the script states")


def test_dead_speculation_rule_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        rule = next(
            r for r in s.scripts["broken_bridge"]["speculation"] if r["id"] == "sr_drunk_reckless"
        )
        # nobody repaired the lantern, so no binding can satisfy this premise
        rule["premises"].append(
            {"pred": "repaired", "args": {"who": "$X", "what": "t_li_er_lantern"}}
        )

    assert has(check(mutate), "sr_drunk_reckless", "no prop of the script satisfies the premises")


def test_speculation_rule_with_an_unbound_variable_is_rejected_without_crashing() -> None:
    def mutate(s: cc.Sources) -> None:
        rule = next(
            r for r in s.scripts["broken_bridge"]["speculation"] if r["id"] == "sr_flood_season"
        )
        rule["conclusion"]["args"]["what"] = "$Z"

    assert has(check(mutate), "sr_flood_season", "variable $Z is not declared")


# --- goals, endings, hard conditions ----------------------------------------------------------


def test_ending_table_with_a_gap_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        rows = s.scripts["broken_bridge"]["endings"]["rows"]
        rows[:] = [r for r in rows if r["id"] != "ending_split"]

    assert has(check(mutate), "endings: no row covers", "bridge_fixed=F")


def test_ending_table_with_an_overlap_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        rows = s.scripts["broken_bridge"]["endings"]["rows"]
        next(r for r in rows if r["id"] == "ending_barely")["when"] = "passable"

    assert has(check(mutate), "endings: rows", "overlap")


def test_detour_alone_may_not_give_the_full_ending() -> None:
    def mutate(s: cc.Sources) -> None:
        en = s.scripts["broken_bridge"]["endings"]
        en["derived"]["all_three"] = {"all": ["detour_done", "reconciled", "truth_told"]}

    assert has(check(mutate), "ending_full", "although bridge_fixed is false")


def test_goal_with_unknown_flag_or_metric_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        goals = s.scripts["broken_bridge"]["goals"]
        goals[0]["done_when"] = {
            "all": [
                {"flag": "bamboo_arrived"},
                {"metric": "work_progress", "op": ">=", "value": 500},
            ]
        }

    errors = check(mutate)
    assert has(errors, "goal g_materials", "unknown flag 'bamboo_arrived'")
    assert has(errors, "goal g_materials", "outside the range of work_progress")


def test_hard_condition_with_an_unknown_kind_or_a_true_rumour_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        alts = s.scripts["broken_bridge"]["hard_conditions"][0]["any"]
        alts[0]["all"].append({"kind": "refuted_publicly", "props": ["pr_boat_damaged"]})
        alts[1]["all"].append({"kind": "bribed", "who": "zuzhang"})
        alts[2]["all"][0]["who"] = "p_temple"

    errors = check(mutate)
    assert has(errors, "hc_rumor_cleared", "'pr_boat_damaged' is true in some variant")
    assert has(errors, "hc_honor_and_trust", "unknown condition kind 'bribed'")
    assert has(errors, "hc_elder_asks", "'p_temple' is a place, expected a person")


# --- openings: the hearsay that is going round when a game starts ------------------------------


def opening(src: cc.Sources) -> dict[str, Any]:
    return src.scripts["broken_bridge"]["openings"][0]


def refusals(src: cc.Sources) -> list[dict[str, Any]]:
    return src.scripts["broken_bridge"]["hard_conditions"][0]["refusals"]


def test_the_opening_of_the_script_passes_and_is_counted() -> None:
    report = cc.validate(copy.deepcopy(BASE))
    assert report.errors == []
    assert any("openings 1 (5 hops)" in line for line in report.coverage)
    data = json.loads((ROOT / "content" / "compiled" / "broken_bridge.json").read_text("utf-8"))
    assert [o["id"] for o in data["openings"]] == ["op_li_er_hearsay"]
    assert data["openings"][0]["quiet_until"] == 1140 and len(data["openings"][0]["hops"]) == 5
    others = ("lost_lantern", "stranger")
    for name in others:  # a script without one compiles to none
        text = (ROOT / "content" / "compiled" / f"{name}.json").read_text("utf-8")
        assert json.loads(text)["openings"] == []


def test_an_opening_hop_between_strangers_or_a_person_and_themselves_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        hops = opening(s)["hops"]
        hops[0]["speaker"] = "nobody"
        hops[1]["listener"] = "p_bridge"
        hops[2]["listener"] = hops[2]["speaker"]

    errors = check(mutate)
    assert has(errors, "opening op_li_er_hearsay hop 1", "unknown entity 'nobody'")
    assert has(errors, "hop 2", "'p_bridge' is a place, expected a person")
    assert has(errors, "hop 3", "zhou_erlang cannot tell themselves")


def test_a_hop_whose_speaker_holds_nothing_to_tell_or_whose_listener_knows_it_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        hops = opening(s)["hops"]
        hops[0]["speaker"] = "cha_laoban"  # the madam saw nothing at the bridge
        hops[3]["speaker"] = "mujiang"  # and the carpenter was told nothing
        hops[4]["listener"] = "li_er"  # while Li Er saw the lantern at the bridge himself
        hops[4]["prop"] = "pr_liner_at_bridge"

    errors = check(mutate)
    assert has(errors, "hop 1", "cha_laoban holds neither pr_liner_at_bridge nor what it was made")
    assert has(errors, "hop 4", "mujiang holds neither pr_liner_damaged_jealous")
    assert has(errors, "hop 5", "li_er holds pr_liner_at_bridge already")


def test_a_changed_version_needs_the_rule_its_step_needs_and_only_that() -> None:
    def mutate(s: cc.Sources) -> None:
        hops = opening(s)["hops"]
        del hops[1]["via"]  # an assimilate that changes the predicate rests on a rule
        hops[2]["via"] = "sr_presence_grudge"  # a sharpen does not
        hops[4]["own"] = 50  # and what is said as it is changes nothing for the speaker

    errors = check(mutate)
    assert has(errors, "hop 2", "needs 'via'")
    assert has(errors, "hop 3", "has no use for 'via'")
    assert has(errors, "hop 5", "only a changed version has 'via' or 'own'")
    assert has(
        check(lambda s: opening(s)["hops"][1].update(via="sr_nothing")), "hop 2", "sr_nothing"
    )


def test_a_version_that_is_not_a_legal_step_of_its_operator_is_rejected() -> None:
    errors = check(
        lambda s: prop(s, "broken_bridge", "pr_liner_damaged_on_purpose").update(op="level")
    )
    assert has(errors, "prop pr_liner_damaged_on_purpose", "level step", "illegal")
    assert has(errors, "opening op_li_er_hearsay hop 3", "level step", "illegal")


def test_an_opening_needs_an_id_a_label_hops_and_a_quiet_inside_the_first_day() -> None:
    def twin(s: cc.Sources) -> None:
        s.scripts["broken_bridge"]["openings"].append(copy.deepcopy(opening(s)))

    assert has(check(twin), "opening op_li_er_hearsay", "duplicate opening id")
    assert has(check(lambda s: opening(s).update(id="Op-1")), "not a lower-case snake_case id")
    assert has(check(lambda s: opening(s).update(label=" ")), "empty label")
    assert has(check(lambda s: opening(s).update(hops=[])), "hops", "at least 1")
    assert has(check(lambda s: opening(s).update(quiet_until=100)), "quiet_until", "360")
    assert has(check(lambda s: opening(s).update(quiet_until=1300)), "quiet_until", "1260")
    assert check(lambda s: opening(s).update(quiet_until=None)) == []
    assert has(check(lambda s: opening(s)["hops"][0].update(extra=1)), "extra")


# --- the reason for a refusal ------------------------------------------------------------------


def test_a_refusal_names_a_fixed_line_and_conditions_of_the_vocabulary() -> None:
    def mutate(s: cc.Sources) -> None:
        rows = refusals(s)
        rows[0]["line"] = "hard_nowhere"
        rows.append({"line": "hard_other", "when": [{"kind": "bribed"}]})
        rows.append({"line": "hard_other", "when": [{"kind": "unspoken", "who": "zuzhang"}]})
        believes = {"kind": "believes", "holder": "li_laotai", "props": ["pr_boat_damaged"]}
        rows.append({"line": "hard_other", "when": [{**believes, "min": 25}]})

    errors = check(mutate)
    assert has(errors, "refusal 1", "'hard_nowhere' is not a fixed line of the core")
    assert has(errors, "refusal 2", "unknown condition kind 'bribed'")
    assert has(errors, "refusal 3", "kind 'unspoken' takes exactly []", "['who']")
    assert has(errors, "refusal 4", "'pr_boat_damaged' is true in some variant")
    assert has(check(lambda s: refusals(s)[0].update(when=[])), "refusals", "when")
    assert has(check(lambda s: refusals(s)[0]["when"][0].update(min=101)), "believes.min")
    assert has(check(lambda s: refusals(s)[0]["when"][0].update(holder="p_bridge")), "p_bridge")


def test_structural_errors_name_the_file_and_field() -> None:
    def mutate(s: cc.Sources) -> None:
        s.scripts["stranger"]["days"] = "seven"
        s.scripts["stranger"]["unexpected"] = 1

    errors = check(mutate)
    assert has(errors, "stranger", "days")
    assert has(errors, "stranger", "unexpected")


def test_script_id_must_match_its_file_name() -> None:
    def mutate(s: cc.Sources) -> None:
        s.scripts["stranger"]["id"] = "other"

    assert has(check(mutate), "stranger: the id 'other' must match the file name")


# --- evidence prerequisites and public refutation ------------------------------------------------


def test_evidence_that_needs_an_item_missing_from_its_variants_is_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        ev = next(e for e in s.scripts["broken_bridge"]["evidence"] if e["id"] == "e_footprint")
        ev["acquire"]["needs"] = ["e_boat_scratches"]  # the scratches do not exist in v_drunk

    assert has(check(mutate), "evidence e_footprint", "needs 'e_boat_scratches'", "unreachable")


def test_evidence_prerequisites_must_not_loop() -> None:
    def mutate(s: cc.Sources) -> None:
        evidence = {e["id"]: e for e in s.scripts["broken_bridge"]["evidence"]}
        evidence["e_liner_testimony"]["acquire"]["needs"] = ["e_huoji_testimony"]

    assert has(check(mutate), "acquire.needs loops back to itself")


def test_an_evidence_set_must_include_what_its_items_need() -> None:
    def mutate(s: cc.Sources) -> None:
        s.scripts["broken_bridge"]["evidence_sets"].append(
            {"id": "es_needs", "tells": "v_flood", "items": ["e_flood_debris", "e_huoji_testimony"]}
        )

    assert has(check(mutate), "es_needs", "'e_huoji_testimony' needs 'e_liner_testimony' first")


def test_public_refutation_needs_evidence_that_refutes_the_rumour() -> None:
    def mutate(s: cc.Sources) -> None:
        alts = s.scripts["broken_bridge"]["hard_conditions"][0]["any"]
        alts[0]["all"].append(
            {"kind": "refuted_publicly", "props": ["pr_li_damaged", "pr_li_damaged_jealous"]}
        )
        for ev in s.scripts["broken_bridge"]["evidence"]:
            if "pr_li_damaged" in ev.get("refutes", []):
                ev["refutes"].remove("pr_li_damaged")

    errors = check(mutate)
    assert has(errors, "hc_rumor_cleared", "no evidence item refutes 'pr_li_damaged'")
    assert has(errors, "hc_rumor_cleared", "no evidence item refutes 'pr_li_damaged_jealous'")


def test_a_condition_that_the_holder_knows_a_claim_takes_a_person_and_props_of_the_script() -> None:
    def mutate(s: cc.Sources) -> None:
        alts = s.scripts["broken_bridge"]["hard_conditions"][0]["any"]
        alts[0]["all"] = [
            {"kind": "knows", "holder": "p_temple", "props": ["pr_nowhere"], "min": 101}
        ]

    errors = check(mutate)
    assert has(errors, "hc_rumor_cleared", "'p_temple' is a place, expected a person")
    assert has(errors, "hc_rumor_cleared", "unknown prop 'pr_nowhere'")
    assert has(errors, "hc_rumor_cleared", "expected an integer 0..100")

    def leave_out(s: cc.Sources) -> None:
        alts = s.scripts["broken_bridge"]["hard_conditions"][0]["any"]
        alts[0]["all"] = [{"kind": "knows", "holder": "li_laotai", "props": ["pr_set_straight"]}]

    assert has(check(leave_out), "hc_rumor_cleared", "kind 'knows' takes exactly")


# --- robustness --------------------------------------------------------------------------------


def _paths(node: Any, prefix: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
    out = [prefix] if prefix else []
    if isinstance(node, dict):
        for k, v in node.items():
            out += _paths(v, (*prefix, k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out += _paths(v, (*prefix, i))
    return out


def test_random_damage_never_crashes_the_checker() -> None:
    """Whatever is wrong with the YAML, the checker reports it rather than raising."""
    rng = random.Random(20261101)
    junk: list[Any] = [None, 0, -1, "", "zzz", [], {}, ["a"], {"a": 1}, True, 10**9, "$X", 3.5]
    for _ in range(250):
        src = copy.deepcopy(BASE)
        docs: dict[str, Any] = {"predicates": src.predicates, "motives": src.motives}
        docs["entities"] = src.entities
        docs.update({f"script:{n}": d for n, d in src.scripts.items()})
        name = rng.choice(sorted(docs))
        path = rng.choice(_paths(docs[name]))
        parent = docs[name]
        for step in path[:-1]:
            parent = parent[step]
        if rng.random() < 0.4:
            del parent[path[-1]]
        else:
            parent[path[-1]] = rng.choice(junk)
        cc.validate(src)  # must not raise


def test_span_outside_the_game_and_too_many_sets_are_rejected() -> None:
    def mutate(s: cc.Sources) -> None:
        prop(s, "broken_bridge", "pr_flooded")["span"] = [-4320, 999999]
        sets = s.scripts["stranger"]["evidence_sets"]
        sets += [
            {"id": f"es_more_{i}", "tells": "v_swindler", "items": ["e_ticket"]} for i in range(6)
        ]

    errors = check(mutate)
    assert has(errors, "pr_flooded", "leaves the game")
    assert has(errors, "variant v_swindler", "evidence sets, at most 6")


# --- tasks and wants: what the player is told to do ----------------------------------------------


def tasks(src: cc.Sources) -> list[dict[str, Any]]:
    return src.scripts["broken_bridge"]["tasks"]


def task(src: cc.Sources, task_id: str) -> dict[str, Any]:
    return next(t for t in tasks(src) if t["id"] == task_id)


def wants(src: cc.Sources) -> list[dict[str, Any]]:
    return src.scripts["broken_bridge"]["wants"]


def test_the_tasks_of_the_script_pass_are_counted_and_compile_to_lists_of_options() -> None:
    report = cc.validate(copy.deepcopy(BASE))
    assert report.errors == []
    line = next(line for line in report.coverage if line.strip().startswith("tasks 38"))
    assert "lead 3, need 8, obstacle 3, promise 21, venue 3" in line and "wants 10" in line
    assert "t_bamboo_first" not in line and "t_what_proves" not in line  # every term is read now
    data = json.loads((ROOT / "content" / "compiled" / "broken_bridge.json").read_text("utf-8"))
    assert [t["id"] for t in data["tasks"]] == [
        "t_bamboo_first",
        "t_who_said",
        "t_what_proves",
        "t_clear_rumour",
        "t_tea_tonight",
        "t_li_da_promise",
        "t_bamboo_rest",  # the bridge, days 2 to 5
        "t_timber",
        "t_helpers",
        "t_work_3",
        "t_work_4",
        "t_detour",
        "t_how_broke",  # the truth and the peace, days 2 to 5
        "t_tell_town",
        "t_make_peace",
        "t_festival_night",
        *[f"t_keep_{n}" for n in range(1, 21)],  # the manager's promises, one task each
        "t_see_for_yourself",  # a game with no opening, the first days
        "t_call_clan",  # the elder's call, days 4 and 5
    ]
    promise = data["tasks"][5]
    assert promise["again"] is True and data["tasks"][0].get("again") is None
    assert promise["why"] == [
        {"when": [], "zh": "李大答应了，按约好的时间送到桥边。", "en": promise["why"][0]["en"]}
    ]
    assert promise["window"] is None  # its window is that of the promise (see agenda)
    assert promise["action"] == []  # nothing to do but be there when it comes: the window says when
    # the bamboo is Li Da's to bring once his mother no longer objects, and Granny Li's before;
    # once he has promised it there is nothing to ask of either, and the reasons and the next
    # steps say so
    first = data["tasks"][0]
    promised = {"kind": "commitment", "by": "li_da", "item": "bamboo", "state": "promised"}
    withdrawn = first["why"][1]["when"]
    assert [len(first[key]) for key in ("why", "next", "action")] == [3, 3, 2]
    assert first["why"][0]["when"] == first["next"][0]["when"] == [promised]
    assert first["next"][1]["when"] == withdrawn
    assert first["why"][2]["when"] == first["next"][2]["when"] == []
    assert [c["event"] for c in withdrawn[0]["any"]] == ["objection_withdrawn", "entrusted"]
    assert [(o["verb"], o["npc"]) for o in first["action"]] == [
        ("entrust", "li_da"),
        ("entrust", "li_laotai"),
    ]
    assert first["action"][0]["when"] == [*withdrawn, {"not": promised}]
    assert first["action"][1]["when"] == [{"not": promised}]
    assert data["tasks"][4]["window"] == {"day": 1, "from": 17, "to": 19, "place": "p_teahouse"}
    assert data["tasks"][4]["expected"] == {"from": 1050, "to": 1140}
    # the clearing up has the teahouse evening for its window every day (no day), and who is there
    assert data["tasks"][3]["window"] == {"day": None, "from": 17, "to": 19, "place": "p_teahouse"}
    assert data["tasks"][3]["expected"] == {"from": 1050, "to": 1140}
    for name in ("lost_lantern", "stranger"):  # a script without any compiles to none
        text = json.loads((ROOT / "content" / "compiled" / f"{name}.json").read_text("utf-8"))
        assert text["tasks"] == [] and text["wants"] == []


def test_the_terms_of_a_condition_are_the_closed_vocabulary_with_the_arguments_of_each() -> None:
    def mutate(s: cc.Sources) -> None:
        bamboo = task(s, "t_bamboo_first")
        bamboo["appears"] = [
            {"kind": "bribed", "who": "zuzhang"},
            {"kind": "refused"},
            {"kind": "refused", "npc": "li_laotai", "extra": 1},
            {"kind": "note", "props": []},
            {"kind": "note", "props": ["pr_nothing"]},
            {"kind": "flag", "flag": "nothing"},
            {"kind": "window", "day": 9, "from": 17, "to": 19},
            {"kind": "after", "day": 1, "hour": 30},
            {"kind": "event", "event": "bribed"},
            {"kind": "event", "event": "spoke", "where": {"venue": ["p_teahouse"]}},
            {"kind": "event", "event": "spoke", "where": {"npc": "p_bridge"}},
            {"kind": "judged", "relation": "guess"},
            {"kind": "commitment", "by": "li_da", "item": "gold", "state": "promised"},
            {"kind": "commitment", "by": "li_da", "item": "bamboo", "state": "lost"},
            {"kind": "at_place", "place": "li_da"},
            {"kind": "note_first_hand", "props": ["pr_liner_at_bridge"], "by": "p_bridge"},
            {"all": []},
            {"not": {"kind": "bribed"}},
            {"all": [], "any": []},
        ]

    errors = check(mutate)
    assert has(errors, "task t_bamboo_first appears", "unknown term 'bribed'")
    assert has(errors, "term 'refused' takes ['npc'] and perhaps ['reason']", "got []")
    assert has(errors, "term 'refused'", "got ['extra', 'npc']")
    assert has(errors, "note.props", "expected a non-empty list of props")
    assert has(errors, "note.props", "unknown prop 'pr_nothing'")
    assert has(errors, "flag.flag", "unknown flag 'nothing'")
    assert has(errors, "window.day", "expected a day from 1 to 5")
    assert has(errors, "after.hour", "expected an hour from 6 to 24")
    assert has(errors, "event.event", "unknown event 'bribed'")
    assert has(errors, "event.where", "field venue must hold a word, a number or a flag")
    assert has(errors, "event.where", "'p_bridge' is a place, expected a person")
    assert has(errors, "judged.relation", "expected one of unsupported, contradicts, mismatch")
    assert has(errors, "commitment.item", "'gold' is neither an item of the cast nor a thing")
    assert has(errors, "commitment.state", "expected one of promised, delivered, broken, withdrawn")
    assert has(errors, "at_place.place", "'li_da' is a person, expected a place")
    assert has(errors, "note_first_hand.by", "'p_bridge' is a place, expected a person")
    assert has(errors, "'all' needs a non-empty list")
    assert has(errors, "unknown term 'None'")  # one of all, any and not, and not two of them
    assert has(check(lambda s: task(s, "t_who_said")["appears"].append("judged")), "appears.")


def test_content_may_use_the_terms_of_the_packages_that_come_after_and_all_and_any_and_not() -> (
    None
):
    def mutate(s: cc.Sources) -> None:
        task(s, "t_who_said")["stale"] = [
            {
                "any": [
                    {"kind": "judged"},
                    {"not": {"kind": "clarified", "props": ["pr_li_damaged"]}},
                ]
            },
            {"kind": "commitment", "by": "li_da", "item": "bamboo", "state": "broken"},
            {"kind": "window", "day": 1, "from": 6, "to": 24},
            {"kind": "at_place", "place": "p_teahouse"},
            {"kind": "flag", "flag": "bridge_fixed"},
        ]

    assert check(mutate) == []


def test_a_task_has_its_own_id_a_kind_of_the_list_a_priority_and_words_in_both_languages() -> None:
    def twin(s: cc.Sources) -> None:
        tasks(s).append(copy.deepcopy(task(s, "t_who_said")))

    assert has(check(twin), "task t_who_said", "duplicate task id")
    assert has(
        check(lambda s: task(s, "t_who_said").update(id="T-1")), "not a lower-case snake_case id"
    )
    assert has(check(lambda s: task(s, "t_who_said").update(kind="chore")), "kind")
    assert has(check(lambda s: task(s, "t_who_said").update(job="fun")), "job")
    assert has(check(lambda s: task(s, "t_who_said").update(priority=0)), "priority")
    assert has(check(lambda s: task(s, "t_who_said").update(priority=100)), "priority")
    assert has(check(lambda s: task(s, "t_who_said")["text"].update(en="")), "text.en")
    assert has(check(lambda s: task(s, "t_who_said").update(extra=1)), "extra")
    assert has(check(lambda s: task(s, "t_who_said").pop("text")), "text")


def test_a_window_is_a_stretch_of_hours_at_a_place_of_the_game_and_the_people_are_theirs() -> None:
    venue = "t_tea_tonight"
    assert has(check(lambda s: task(s, venue)["window"].update(place="nowhere")), "unknown entity")
    assert has(check(lambda s: task(s, venue)["window"].update(place="li_da")), "is a person")
    assert has(check(lambda s: task(s, venue)["window"].update(day=6)), "after the game")
    assert has(check(lambda s: task(s, venue)["window"].update(to=17)), "window must end after")
    assert has(check(lambda s: task(s, venue)["window"].update(**{"from": 5})), "window.from")
    assert has(
        check(lambda s: task(s, venue)["expected"].update(to=1000)), "'expected' must end after"
    )
    assert has(check(lambda s: task(s, venue)["expected"].update(**{"from": 300})), "expected.from")
    assert has(check(lambda s: task(s, venue)["expected"].update(to=1300)), "expected.to")
    assert has(check(lambda s: task(s, venue).update(window=None)), "'expected' is the people")
    assert check(lambda s: task(s, venue).update(window=None, expected=None)) == []


def test_an_action_names_the_person_place_and_item_its_verb_needs() -> None:
    def action(s: cc.Sources, **fields: Any) -> None:
        task(s, "t_tea_tonight")["action"] = {**fields}

    assert has(check(lambda s: action(s, verb="dance")), "verb")
    assert has(check(lambda s: action(s, verb="move")), "action 1", "the verb move needs a place")
    assert has(check(lambda s: action(s, verb="move", place="li_da")), "'li_da' is a person")
    assert has(check(lambda s: action(s, verb="move", place="p_workshop")), "not listed in cast")
    assert has(check(lambda s: action(s, verb="talk")), "the verb talk needs a person")
    assert has(
        check(lambda s: action(s, verb="talk", npc="p_bridge")), "is a place, expected a person"
    )
    assert has(check(lambda s: action(s, verb="look")), "the verb look needs a thing or a place")
    assert has(check(lambda s: action(s, verb="look", item="t_nothing")), "neither an item")
    assert check(lambda s: action(s, verb="look", item="t_rail")) == []
    assert check(lambda s: action(s, verb="entrust", npc="li_laotai", item="bamboo")) == []
    assert has(check(lambda s: action(s, verb="listen", follow=["pr_li_damaged"])), "follow is for")
    assert has(check(lambda s: action(s, verb="ask", npc="$frontier")), "is for ask_source")
    frontier = {"verb": "ask_source", "npc": "$frontier"}
    assert has(check(lambda s: action(s, **frontier)), "needs the props to follow")
    assert has(check(lambda s: action(s, **frontier, follow=["pr_nothing"])), "unknown prop")
    assert check(lambda s: action(s, **frontier, follow=["pr_li_damaged"])) == []
    assert has(check(lambda s: action(s, verb="speak", when=[{"kind": "bribed"}])), "unknown term")


def test_an_entrust_may_name_its_request_a_speak_its_kind_and_a_persuasion_its_target() -> None:
    def action(s: cc.Sources, **fields: Any) -> None:
        task(s, "t_tea_tonight")["action"] = {**fields}

    ok = {"verb": "entrust", "npc": "miaozhu"}
    assert check(lambda s: action(s, **ok, request="lane")) == []
    assert check(lambda s: action(s, **ok, request="join")) == []
    assert check(lambda s: action(s, **ok, request="testify")) == []
    assert check(lambda s: action(s, **ok, request="material", item="timber")) == []
    persuade = {"verb": "entrust", "npc": "zuzhang", "request": "persuade"}
    assert check(lambda s: action(s, **persuade, target="li_laotai")) == []
    assert check(lambda s: action(s, verb="speak", kind="meal")) == []
    assert check(lambda s: action(s, verb="speak", kind="evidence")) == []
    assert check(lambda s: action(s, verb="speak", kind="clarify")) == []
    assert has(check(lambda s: action(s, **ok, request="beg")), "request")
    assert has(check(lambda s: action(s, verb="speak", kind="shout")), "kind")
    assert has(
        check(lambda s: action(s, verb="talk", npc="miaozhu", request="lane")), "request is for"
    )
    assert has(check(lambda s: action(s, **ok, request="material")), "names the item")
    assert has(
        check(lambda s: action(s, **ok, request="lane", item="bamboo")), "only a request for"
    )
    assert has(check(lambda s: action(s, **persuade)), "names the person to talk round")
    assert has(check(lambda s: action(s, **ok, request="lane", target="li_da")), "target is for")
    assert has(check(lambda s: action(s, **persuade, target="p_bridge")), "is a place")
    assert has(check(lambda s: action(s, verb="ask", npc="miaozhu", kind="meal")), "kind is for")


def test_the_person_to_ask_to_join_is_a_selector_that_goes_with_the_request_to_join() -> None:
    def action(s: cc.Sources, **fields: Any) -> None:
        task(s, "t_tea_tonight")["action"] = {**fields}

    assert check(lambda s: action(s, verb="entrust", npc="$helper", request="join")) == []
    assert check(lambda s: action(s, verb="promise", npc="$helper")) == []
    assert has(
        check(lambda s: action(s, verb="entrust", npc="$helper")), "$helper is for an entrust"
    )
    assert has(
        check(lambda s: action(s, verb="entrust", npc="$helper", request="lane")), "$helper is for"
    )
    assert has(check(lambda s: action(s, verb="ask", npc="$helper")), "$helper is for an entrust")


def test_what_a_task_does_not_say_is_left_out_of_the_compiled_script():
    report = cc.validate(copy.deepcopy(BASE))
    tasks_ = {t["id"]: t for t in json.loads(report.outputs["broken_bridge.json"])["tasks"]}
    assert "again" not in tasks_["t_who_said"] and tasks_["t_li_da_promise"]["again"] is True
    for action in tasks_["t_bamboo_first"]["action"]:
        assert not {"request", "kind", "target"} & set(action)
    helpers = tasks_["t_helpers"]["action"]
    assert helpers[0] == {
        "verb": "rally",
        "npc": None,
        "place": None,
        "item": None,
        "follow": [],
        "when": helpers[0]["when"],
    }
    assert helpers[1]["npc"] == "$helper" and helpers[1]["request"] == "join"
    assert "kind" not in helpers[1] and "target" not in helpers[1]


def test_the_terms_of_the_days_after_the_first_take_their_arguments() -> None:
    def mutate(s: cc.Sources) -> None:
        task(s, "t_who_said")["appears"] = [
            {"kind": "crew", "at_least": 5},
            {"kind": "helpers"},
            {"kind": "helpers", "at_least": 0},
            {"kind": "helpers", "at_least": 2, "family": "li_da"},
            {"kind": "helpers", "at_least": 2, "family": "nobody"},
            {"kind": "work", "percent": 0},
            {"kind": "work", "percent": 101},
            {"kind": "work", "percent": "all"},
            {"kind": "weather", "is": "hail"},
            {"kind": "weather"},
            {
                "kind": "commitment",
                "by": "li_da",
                "item": "bamboo",
                "state": "promised",
                "latest": False,
            },
            {"kind": "turned_down", "npc": "p_bridge"},
            {"kind": "turned_down", "npc": "li_da", "request": "join"},
            {"kind": "turned_down"},
            {"kind": "can_promise"},
        ]

    errors = check(mutate)
    assert has(errors, "term 'crew' takes [] and perhaps []", "got ['at_least']")
    assert has(errors, "term 'helpers' takes ['at_least'] and perhaps ['family']", "got []")
    assert has(errors, "helpers.at_least", "expected a number of people from 1 up")
    assert has(errors, "helpers.family", "'li_da' is a person, expected a family")
    assert has(errors, "helpers.family", "unknown entity")
    assert has(errors, "work.percent", "expected a per cent from 1 to 100")
    assert has(errors, "weather.is", "expected one of clear, light_rain, heavy_rain")
    assert has(errors, "term 'weather' takes ['is']", "got []")
    assert has(errors, "commitment.latest", "expected true")
    assert has(errors, "turned_down.npc", "'p_bridge' is a place, expected a person")
    assert has(errors, "turned_down.request", "expected one of material, lane")
    assert has(errors, "term 'turned_down' takes ['npc'] and perhaps ['request']", "got []")
    assert has(errors, "term 'can_promise' takes ['npc']", "got []")
    ok = [
        {"kind": "crew"},
        {"kind": "helpers", "at_least": 3},
        {"kind": "helpers", "at_least": 1, "family": "fam_li"},
        {"kind": "work", "percent": 100},
        {"kind": "weather", "is": "heavy_rain"},
        {
            "kind": "commitment",
            "by": "li_da",
            "item": "bamboo",
            "state": "promised",
            "latest": True,
        },
        {"kind": "turned_down", "npc": "li_da"},
        {"kind": "turned_down", "npc": "miaozhu", "request": "lane"},
        {"kind": "can_promise", "npc": "li_da"},
    ]
    assert check(lambda s: task(s, "t_who_said").update(appears=ok)) == []


def test_the_words_of_a_task_may_carry_the_numbers_of_the_game_and_nothing_else_in_braces() -> None:
    def why(s: cc.Sources, zh: str, en: str) -> None:
        task(s, "t_timber")["why"][1].update(zh=zh, en=en)

    assert check(lambda s: why(s, "要{timber_need}根", "needs {timber_need} poles")) == []
    assert has(check(lambda s: why(s, "要{planks}根", "needs {planks} poles")), "{planks} is not")
    assert has(
        check(lambda s: why(s, "要{timber_need}根", "needs {bamboo_need} poles")),
        "the two languages write different slots",
    )
    assert has(check(lambda s: why(s, "要{timber_need}根", "needs poles")), "different slots")
    assert has(
        check(lambda s: why(s, "要{timber_need}根}", "needs {timber_need} poles")), "stray brace"
    )
    assert has(check(lambda s: why(s, "要根", "needs {timber_need} poles")), "different slots")
    blocker = lambda s: task(s, "t_timber")["blocked"][0]["blocker"].update(  # noqa: E731
        zh="不肯出{wood}", en="will not give {wood}"
    )
    assert has(check(blocker), "blocked 1 blocker", "{wood} is not")
    title = lambda s: task(s, "t_timber")["text"].update(zh="木料{timber_need}", en="Timber")  # noqa: E731
    assert has(check(title), "the title has no slots")
    assert has(check(lambda s: task(s, "t_timber").update(again="maybe")), "again")


def test_a_blocked_rule_needs_conditions_a_blocker_and_options_like_the_rest() -> None:
    def rule(s: cc.Sources) -> dict[str, Any]:
        return task(s, "t_bamboo_first")["blocked"][0]

    assert has(check(lambda s: rule(s).update(when=[])), "blocked.0.when", "at least 1")
    assert has(check(lambda s: rule(s).pop("blocker")), "blocker")
    assert has(
        check(lambda s: rule(s).update(when=[{"kind": "bribed"}])), "blocked 1", "unknown term"
    )
    assert has(
        check(lambda s: rule(s).update(why=[{"zh": "x", "en": "y", "when": [{"kind": "bribed"}]}])),
        "blocked 1 why option 1",
    )
    assert has(check(lambda s: rule(s).update(action=[{"verb": "move"}])), "blocked 1 action 1")
    assert check(lambda s: rule(s).update(why={"zh": "只有一句", "en": "A single option"})) == []


def test_a_want_is_a_person_a_text_and_conditions_for_the_player_to_have_learned_it() -> None:
    def twin(s: cc.Sources) -> None:
        wants(s).append(copy.deepcopy(wants(s)[0]))

    assert has(check(twin), "want w_elder_lantern", "duplicate want id")
    assert has(check(lambda s: wants(s)[0].update(id="W 1")), "not a lower-case snake_case id")
    assert has(
        check(lambda s: wants(s)[0].update(person="p_bridge")), "is a place, expected a person"
    )
    assert has(check(lambda s: wants(s)[0].update(person="nobody")), "unknown entity")
    assert has(check(lambda s: wants(s)[0]["text"].update(zh="")), "text.zh")
    assert has(
        check(lambda s: wants(s)[1].update(learned=[{"kind": "bribed"}])), "learned", "unknown term"
    )
    assert check(lambda s: wants(s)[1].update(learned=[])) == []


# --- how long the acts of the manager take -------------------------------------------------


def test_the_acts_take_the_minutes_the_script_gives_and_a_script_that_says_nothing_gets_these():
    report = cc.validate(copy.deepcopy(BASE))
    wanted = {"ask": 10, "ask_source": 10, "tell": 15, "entrust": 20, "promise": 20, "speak": 30}
    for name in SCRIPTS:
        assert json.loads(report.outputs[f"{name}.json"])["act_minutes"] == wanted
    assert BASE.scripts["broken_bridge"]["act_minutes"] == wanted  # written in the script
    assert "act_minutes" not in BASE.scripts["stranger"]  # the others say nothing and get these

    slower = copy.deepcopy(BASE)
    slower.scripts["stranger"]["act_minutes"] = {"ask": 25}  # one act, and the rest as they are
    report = cc.validate(slower)
    assert report.errors == []
    assert json.loads(report.outputs["stranger.json"])["act_minutes"] == {**wanted, "ask": 25}


def test_an_act_takes_a_whole_number_of_minutes_between_one_and_a_four_hours_and_no_other_acts():
    def minutes(**fields: Any) -> list[str]:
        return check(lambda s: s.scripts["broken_bridge"]["act_minutes"].update(fields))

    assert has(minutes(ask=0), "act_minutes.ask", "greater than or equal to 1")
    assert has(minutes(tell=241), "act_minutes.tell", "less than or equal to 240")
    assert has(minutes(promise="long"), "act_minutes.promise")
    assert has(minutes(listen=5), "act_minutes.listen", "Extra inputs are not permitted")
    assert minutes(entrust=240, speak=1) == []


def commitments_of(src: cc.Sources) -> dict[str, Any]:
    return src.scripts["broken_bridge"]["commitments"]


def test_the_commitments_of_the_script_compile_and_a_script_without_any_has_none() -> None:
    report = cc.validate(copy.deepcopy(BASE))
    assert report.errors == []
    data = json.loads((ROOT / "content" / "compiled" / "broken_bridge.json").read_text("utf-8"))
    rules = data["commitments"]
    assert rules["batches"] == {"bamboo": 4}
    assert rules["due"] == {"cutoff": 15, "soon": 2, "late": 7}
    assert (rules["start"], rules["grace"], rules["recap_hour"]) == (6, 3, 7)
    assert set(rules["reasons"]) == {"rain", "failed", "late", "taken_back"}
    assert set(rules["recap"]) == {
        "delivery",
        "withdrawn",
        "withdrawn_plain",
        "clarified",
        "promise",
    }
    for name in ("lost_lantern", "stranger"):
        text = json.loads((ROOT / "content" / "compiled" / f"{name}.json").read_text("utf-8"))
        assert text["commitments"] is None


def test_the_rules_for_the_promises_are_held_to_the_cast_the_day_and_the_words() -> None:
    assert has(
        check(lambda s: commitments_of(s)["batches"].update(gold=2)),
        "commitments batches",
        "'gold' is not an item of the cast",
    )
    assert has(check(lambda s: commitments_of(s)["batches"].update(bamboo=0)), "must be at least 1")
    assert has(
        check(lambda s: commitments_of(s)["due"].update(cutoff=21, soon=2)),
        "falls due after the day",
    )
    assert has(check(lambda s: commitments_of(s).update(start=9)), "must set out", "before")
    assert has(check(lambda s: commitments_of(s)["due"].update(soon=0)), "commitments")
    assert has(check(lambda s: commitments_of(s).pop("reasons")), "reasons")
    assert has(check(lambda s: commitments_of(s)["reasons"].pop("rain")), "rain")
    assert has(
        check(lambda s: commitments_of(s)["what"].update(en="Bring {amount} of {gold}")),
        "commitments what en",
        "unknown placeholder ['gold']",
    )
    assert has(
        check(lambda s: commitments_of(s)["recap"]["promise"].update(zh="{who}答应{place}")),
        "commitments recap.promise zh",
        "unknown placeholder ['place']",
    )
    assert has(
        check(lambda s: commitments_of(s)["recap"]["clarified"].update(en="{names")),
        "commitments recap.clarified en",
    )
    assert check(lambda s: commitments_of(s)["batches"].update(timber=3)) == []


# --- the paper of the morning and the summary of the night ---------------------------------------


def paper_of(src: cc.Sources) -> dict[str, Any]:
    return src.scripts["broken_bridge"]["paper"]


def test_the_paper_of_the_script_compiles_and_a_script_without_one_compiles_as_it_did() -> None:
    report = cc.validate(copy.deepcopy(BASE))
    assert report.errors == []
    data = json.loads((ROOT / "content" / "compiled" / "broken_bridge.json").read_text("utf-8"))
    paper = data["paper"]
    assert set(paper) == {"when", "street", "news", "talk"}
    assert set(paper["when"]) == {"morning", "night"}
    assert set(paper["street"]) == {
        "warm", "cool", "swing", "camp", "side", "split", "lean_swing", "fresh",
    }  # fmt: skip
    assert len(paper["news"]) == 17 and len(paper["talk"]) == 15
    for name in ("lost_lantern", "stranger"):  # the key is left out where a script has no paper
        text = json.loads((ROOT / "content" / "compiled" / f"{name}.json").read_text("utf-8"))
        assert "paper" not in text


def test_the_paper_is_held_to_its_words_its_placeholders_and_its_thresholds() -> None:
    assert has(check(lambda s: paper_of(s).pop("news")), "paper", "news")
    assert has(check(lambda s: paper_of(s)["news"].pop("quiet")), "quiet")
    assert has(check(lambda s: paper_of(s)["talk"].pop("split")), "split")
    assert has(check(lambda s: paper_of(s)["talk"]["peace"].update(zh="")), "talk.peace.zh")
    assert has(check(lambda s: paper_of(s)["news"].update(extra={"zh": "x", "en": "x"})), "extra")
    assert has(
        check(lambda s: paper_of(s)["news"]["statement"].update(en="At the {venue}")),
        "paper news.statement en",
        "unknown placeholder ['venue']",
    )
    assert has(
        check(lambda s: paper_of(s)["talk"]["peace"].update(zh="街上说{who}和好了")),
        "paper talk.peace zh",
        "unknown placeholder ['who']",
    )
    assert has(
        check(lambda s: paper_of(s)["news"]["helpers"].update(en="{n more")),
        "paper news.helpers en",
    )
    assert has(check(lambda s: paper_of(s)["street"].update(cool=50, warm=50)), "cool", "warm")
    assert has(check(lambda s: paper_of(s)["street"].update(split=30, side=30)), "split", "side")
    assert has(check(lambda s: paper_of(s)["street"].update(camp=0)), "street.camp")
    assert check(lambda s: paper_of(s)["street"].update(warm=60, cool=20)) == []


def test_no_line_of_the_paper_says_a_person_is_he_or_she() -> None:
    assert has(
        check(lambda s: paper_of(s)["talk"]["split"].update(zh="他们分成了两拨")),
        "paper talk.split zh",
        "he or she",
    )
    assert has(
        check(lambda s: paper_of(s)["news"]["meal"].update(en="She shared a meal")),
        "paper news.meal en",
        "he or she",
    )
    assert has(
        check(lambda s: paper_of(s)["news"]["meal"].update(zh="她们同席吃了饭")), "news.meal zh"
    )
    # a word that only contains the letters is not a pronoun
    assert check(lambda s: paper_of(s)["news"]["meal"].update(en="They shared a meal")) == []
    assert (
        check(lambda s: paper_of(s)["news"]["meal"].update(en="The shepherd shared a meal")) == []
    )


# --- what the town says of each person ---------------------------------------------------------


def person_entry(src: cc.Sources, person: str) -> dict[str, Any]:
    return next(p for p in src.entities["people"] if p["id"] == person)


def test_every_person_of_the_cast_has_a_bio_in_both_languages_and_the_cast_carries_it() -> None:
    cast = json.loads((ROOT / "content" / "compiled" / "cast_bridge_v0.json").read_text("utf-8"))
    entries = {p["id"]: p for p in BASE.entities["people"]}
    assert len(cast["people"]) == 20
    for person in cast["people"]:
        bio = entries[person["id"]]["bio"]
        assert set(bio) == {"zh", "en"} and bio["zh"].strip() and bio["en"].strip()
        assert person["bio"] == bio
        assert len(bio["zh"]) <= cc.BIO_LIMIT["zh"] and len(bio["en"]) <= cc.BIO_LIMIT["en"]
    # the three of the other scripts are in no cast and have none, and entities.json is the same
    outside = set(entries) - {p["id"] for p in cast["people"]}
    assert outside == {"apprentice", "stranger", "huolang"}
    data = json.loads((ROOT / "content" / "compiled" / "entities.json").read_text("utf-8"))
    assert all("bio" not in e for e in data["entities"])


def test_a_person_of_the_cast_needs_a_bio_in_each_language() -> None:
    errors = check(lambda s: person_entry(s, "li_er").pop("bio"))
    assert has(errors, "cast/bridge_v0: li_er", "needs a bio")
    assert [e for e in errors if "needs a bio" in e] == [e for e in errors if "li_er" in e]
    assert has(check(lambda s: person_entry(s, "li_er")["bio"].pop("en")), "bio.en", "required")
    assert has(check(lambda s: person_entry(s, "li_er")["bio"].pop("zh")), "bio.zh", "required")
    assert has(
        check(lambda s: person_entry(s, "li_er")["bio"].update(fr="Li Er")),
        "bio.fr",
        "not permitted",
    )


def test_a_person_outside_every_cast_needs_no_bio_but_a_bio_is_checked_where_it_is() -> None:
    def give(zh: str) -> Callable[[cc.Sources], None]:
        return lambda s: person_entry(s, "stranger").update(bio={"zh": zh, "en": "A man."})

    assert check(give("外乡人。")) == []
    assert has(check(give("外乡人；")), "entities.yaml: stranger bio (zh)", "'；'")
    on_a_place = check(lambda s: s.entities["places"][0].update(bio={"zh": "旧", "en": "Old"}))
    assert has(on_a_place, "bio", "not permitted")


@pytest.mark.parametrize(
    ("lang", "text", "needles"),
    [
        ("zh", "他很忙；也很累。", ("(zh)", "'；'")),
        ("zh", "他很忙;也很累。", ("(zh)", "';'")),
        ("zh", "他很忙——也很累。", ("(zh)", "'—'")),
        ("en", "He is busy; he is tired.", ("(en)", "';'")),
        ("en", "He is busy \u2014 and tired.", ("(en)", "'—'")),
        ("en", "He is busy \u2013 and tired.", ("(en)", "'–'")),
        ("en", "He is busy -- and tired.", ("(en)", "'--'")),
        ("zh", "忙" * (cc.BIO_LIMIT["zh"] + 1), ("(zh)", "71 characters, at most 70")),
        ("en", "x" * (cc.BIO_LIMIT["en"] + 1), ("(en)", "321 characters, at most 320")),
        ("zh", "He is busy.", ("the Chinese must be Chinese",)),
        ("en", "他很忙。", ("the English must be English",)),
        ("zh", " 他很忙。", ("(zh)", "one line")),
        ("en", "He is busy.\nHe is tired.", ("(en)", "one line")),
    ],
)
def test_a_bio_with_a_semicolon_a_dash_the_wrong_language_or_the_wrong_length_is_refused(
    lang: str, text: str, needles: tuple[str, ...]
) -> None:
    errors = check(lambda s: person_entry(s, "li_er")["bio"].update({lang: text}))
    assert has(errors, "entities.yaml: li_er bio", *needles), errors


def test_a_bio_of_exactly_the_longest_length_passes() -> None:
    def longest(src: cc.Sources) -> None:
        person_entry(src, "li_er")["bio"].update(zh="忙" * 70, en="x" * 320)

    assert check(longest) == []
