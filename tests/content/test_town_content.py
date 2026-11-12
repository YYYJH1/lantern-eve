"""The town and the cast of the bridge scenario: their compiled form, their checks.

The first half reads the compiled files and holds the content to what the game needs: twenty
named people, two families of five, the network roles, the places that the story needs. The
second half edits the parsed YAML in memory and runs the checker, which has to refuse each
mistake and say where it is.
"""

from __future__ import annotations

import copy
import re
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

import check_content as cc
import town_content as tc
from lantern_core import canon
from lantern_core.cognition.props import Tables
from lantern_core.cognition.script import ScriptBook
from lantern_core.world.bridge import data

ROOT = Path(__file__).resolve().parents[2]
COMPILED = ROOT / "content" / "compiled"
BASE = cc.load_sources(ROOT)
TOWN = canon.loads((COMPILED / "map_bridge_town.json").read_bytes())
CAST = canon.loads((COMPILED / "cast_bridge_v0.json").read_bytes())
ENTITIES = {e["id"]: e for e in canon.loads((COMPILED / "entities.json").read_bytes())["entities"]}
SCRIPT = canon.loads((COMPILED / "broken_bridge.json").read_bytes())
PEOPLE = {p["id"]: p for p in CAST["people"]}
PLACES = {p["id"]: p for p in TOWN["places"]}
STRING_LINE = re.compile(r'\s*"\w+": ".*",?')  # one key and its sentence, as the module sets it


def check(mutate: Callable[[cc.Sources], None]) -> list[str]:
    """Apply ``mutate`` to a copy of the parsed sources and return the errors."""
    src = copy.deepcopy(BASE)
    mutate(src)
    return cc.validate(src).errors


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


def town_src(src: cc.Sources) -> dict[str, Any]:
    return src.maps["bridge_town"]


def cast_src(src: cc.Sources) -> dict[str, Any]:
    return src.casts["bridge_v0"]


def person_src(src: cc.Sources, person_id: str) -> dict[str, Any]:
    return next(p for p in cast_src(src)["people"] if p["id"] == person_id)


def place_src(src: cc.Sources, place_id: str) -> dict[str, Any]:
    return next(p for p in town_src(src)["places"] if p["id"] == place_id)


# ------------------------------------------------------------------------------ the cast


def test_the_cast_is_twenty_named_people_with_unique_ids():
    assert CAST["size"] == len(CAST["people"]) == 20
    assert len(PEOPLE) == 20
    assert CAST["scenario"] == "bridge" and CAST["script"] == "broken_bridge"


def test_two_families_of_five_and_the_network_roles_two_or_three_each():
    families = Counter(p["family"] for p in CAST["people"])
    assert families["fam_li"] == families["fam_zhou"] == 5 and families[None] == 10
    tags = Counter(t for p in CAST["people"] for t in p["tags"])
    assert set(tags) == {"hub", "bridge", "gatekeeper", "witness"}
    assert all(2 <= n <= 3 for n in tags.values()), tags
    assert [p["id"] for p in CAST["people"] if "bridge" in p["tags"]] == [
        "li_xiaomei",
        "zhou_erlang",
        "old_he",
    ]  # the two lovers and the boatman, who carry a rumour from one family to the other
    assert {p["id"] for p in CAST["people"] if "witness" in p["tags"]} == {"xiao_man", "gengfu"}


def test_every_person_of_the_cast_is_an_entity_with_the_same_names_and_family():
    assert set(PEOPLE) <= set(ENTITIES)
    assert all(ENTITIES[i]["type"] == "person" for i in PEOPLE)
    # the four people who joined the entities last are in the cast of the broken-bridge script
    in_script = {e["id"] for e in SCRIPT["entities"] if e["type"] == "person"}
    assert {"li_xiaomei", "zhou_niangzi", "zhou_erlang", "sishu_xiansheng"} <= in_script
    # every person of the script is here, and the boy Shitou of the Li family is not in the script
    assert in_script <= set(PEOPLE) and "shitou" in set(PEOPLE) - in_script
    for person_id in PEOPLE:
        e, p = ENTITIES[person_id], PEOPLE[person_id]
        assert (p["zh"], p["en"], p["family"]) == (e["label"], e["label_en"], e["family"])


def test_the_holdings_are_the_bamboo_of_li_da_the_timber_of_the_shopkeeper_and_the_tools():
    held = {p["id"]: p["holdings"] for p in CAST["people"] if p["holdings"]}
    assert held == {
        "li_da": [{"item": "bamboo", "qty": 30, "at": "p_li_house"}],
        "zhou_zhanggui": [{"item": "timber", "qty": 24, "at": "p_zhou_house"}],
        "mujiang": [{"item": "tools", "qty": 3, "at": "p_workshop"}],
    }


def test_every_person_has_two_names_a_token_traits_and_operator_weights():
    for p in CAST["people"]:
        assert p["zh"] and p["en"].isascii() and p["en"]
        assert len(p["token"]["zh"]) == 1 and p["token"]["en"].isupper()
        assert set(p["traits"]) == {"gossip", "conformity", "suspicion", "warmth"}
        assert all(type(v) is int and 0 <= v <= 100 for v in p["traits"].values())
        assert set(p["ops"]) == {"level", "sharpen", "assimilate", "fill"}
        assert sum(p["ops"].values()) == 100
    # the teahouse keeper is the hub that loves to sharpen what she passes on
    madam = PEOPLE["cha_laoban"]
    assert madam["ops"]["sharpen"] == max(madam["ops"].values())
    assert madam["traits"]["gossip"] == max(p["traits"]["gossip"] for p in CAST["people"])
    assert max(PEOPLE[i]["traits"]["gossip"] for i in ("zuzhang", "zhangfang", "miaozhu")) <= 20


def test_the_tokens_of_a_family_are_its_surname():
    for family, token in (("fam_li", "李"), ("fam_zhou", "周")):
        assert {p["token"]["zh"] for p in CAST["people"] if p["family"] == family} == {token}
    assert PEOPLE["old_he"]["token"] == {"zh": "何", "en": "H"}


def test_every_routine_runs_round_the_clock_and_ends_at_home():
    for p in CAST["people"]:
        routine = p["routine"]
        assert routine[0]["hour"] == 6
        keys = [(e["hour"] - 6) % 24 for e in routine]
        assert keys == sorted(set(keys)), p["id"]
        assert routine[-1]["place"] == p["home"]
        assert p["home"] in PLACES and p["work"] in PLACES
        if not p["night_shift"]:
            assert routine[-1]["act"] == "sleep"
    assert {p["id"] for p in CAST["people"] if p["night_shift"]} == {"xiao_man", "gengfu"}


# ------------------------------------------------------------------------------ the town


def test_the_town_has_the_places_the_story_needs_with_two_names_each():
    for wanted in (
        "p_bridge", "p_teahouse", "p_clan_hall", "p_temple", "p_ferry", "p_workshop", "p_market",
        "p_li_house", "p_zhou_house", "p_temple_lane", "p_he_home", "p_tavern", "p_riverbank",
        "p_under_bridge",
    ):  # fmt: skip
        assert wanted in PLACES, wanted
    for p in TOWN["places"]:
        assert p["zh"] and p["en"] and p["en"].isascii()
        if p["id"] in ENTITIES:
            assert (p["zh"], p["en"]) == (ENTITIES[p["id"]]["label"], ENTITIES[p["id"]]["label_en"])
    # every place of the broken-bridge script is on the map
    assert {e["id"] for e in SCRIPT["entities"] if e["type"] == "place"} <= set(PLACES)


def test_the_map_is_a_compact_grid_with_a_legend_of_every_character_it_uses():
    rows = TOWN["rows"]
    assert (TOWN["width"], TOWN["height"]) == (len(rows[0]), len(rows)) == (56, 34)
    assert {len(r) for r in rows} == {56}
    legend = {e["char"]: e for e in TOWN["legend"]}
    assert set("".join(rows)) <= set(legend)
    assert {e["id"] for e in legend.values()} >= {
        "river", "bridge", "street", "lane", "grass", "wall", "building",
    }  # fmt: skip
    assert legend["~"]["cost"] == 0 and legend["="]["cost"] == 1 and legend["."]["cost"] == 3


def test_the_river_has_one_bridge_and_the_pier_does_not_reach_across():
    rows = TOWN["rows"]
    cost = {e["char"]: e["cost"] for e in TOWN["legend"]}
    town = tc.Town("t", rows, cost, {}, {})
    west = tuple(PLACES["p_li_house"]["door"])
    seen = tc.reach(town, west)
    for p in TOWN["places"]:
        if p["door"] is not None:
            assert tuple(p["door"]) in seen, p["id"]  # the whole town is one piece
    no_bridge = [r.replace("=", "~") for r in rows]
    town = tc.Town("t", no_bridge, cost, {}, {})
    cut = tc.reach(town, west)
    east = tuple(PLACES["p_zhou_house"]["door"])
    assert east not in cut and tuple(PLACES["p_teahouse"]["door"]) not in cut
    assert tuple(PLACES["p_workshop"]["door"]) in cut  # the west bank stays whole


def lane_pieces(rows):
    """How many separate pieces the open cells of the lane form."""
    walk = {tuple(c) for c in PLACES["p_temple_lane"]["cells"] if rows[c[1]][c[0]] == ":"}
    seen: set[tuple[int, int]] = set()
    pieces = 0
    for start in sorted(walk):
        if start in seen:
            continue
        pieces += 1
        seen.add(start)
        stack = [start]
        while stack:
            x, y = stack.pop()
            for step in ((0, -1), (1, 0), (0, 1), (-1, 0)):
                cell = (x + step[0], y + step[1])
                if cell in walk and cell not in seen:
                    seen.add(cell)
                    stack.append(cell)
    return pieces


def test_the_lane_behind_the_temple_is_cut_by_a_barrier_that_can_open():
    (barrier,) = TOWN["barriers"]
    assert (
        barrier["place"] == "p_temple_lane" and barrier["closed"] == "#" and barrier["open"] == ":"
    )
    rows = TOWN["rows"]
    lane = PLACES["p_temple_lane"]
    assert all(rows[y][x] == "#" for x, y in barrier["cells"])
    assert [c for c in barrier["cells"] if c in lane["cells"]] == barrier["cells"]
    assert lane_pieces(rows) == 2  # closed: the lane breaks in two where the junk lies
    opened = [list(r) for r in rows]
    for x, y in barrier["cells"]:
        opened[y][x] = barrier["open"]
    assert lane_pieces(["".join(r) for r in opened]) == 1  # open: one lane from the east road
    # the lane touches the east road at one end and the end of the main street at the other
    assert tuple(lane["cells"][0]) == (45, 24) and tuple(lane["cells"][-1]) == (55, 23)


def test_the_places_people_stand_at_are_distinct_walkable_cells_in_their_rect():
    cost = {e["char"]: e["cost"] for e in TOWN["legend"]}
    for p in TOWN["places"]:
        if p["door"] is None:
            continue
        cells = [tuple(p["door"]), *map(tuple, p["stands"])]
        assert len(set(cells)) == len(cells), p["id"]
        x0, y0, w, h = p["rect"]
        for x, y in cells:
            assert cost[TOWN["rows"][y][x]] > 0 and x0 <= x < x0 + w and y0 <= y < y0 + h, p["id"]


# ------------------------------------------------------------------------------ the module


def test_the_generated_module_holds_exactly_the_compiled_json():
    assert data.TOWN == TOWN and data.CAST == CAST
    assert canon.loads((COMPILED / "tables.json").read_bytes()) == data.TABLES
    assert data.SCRIPT == SCRIPT and data.SCRIPT["id"] == CAST["script"]
    report = cc.validate(copy.deepcopy(BASE))
    assert (
        report.generated["core/lantern_core/world/bridge/data.py"]
        == (ROOT / "core/lantern_core/world/bridge/data.py").read_bytes()
    )


def test_the_compiled_files_are_canonical_and_the_module_is_plain_text_a_person_can_diff():
    for name in ("map_bridge_town.json", "cast_bridge_v0.json"):
        raw = (COMPILED / name).read_bytes()
        assert canon.dumps(canon.loads(raw)) == raw
    text = (ROOT / "core/lantern_core/world/bridge/data.py").read_text(encoding="utf-8")
    lines = text.splitlines()
    assert len(lines) > 500
    # A string cannot be broken, so a sentence (the bio of a person) is one line however long it is.
    # Everything else is set in 100 columns.
    assert all(len(line) <= 100 or STRING_LINE.fullmatch(line) for line in lines)
    assert "Do not edit" in text.split('"""')[1]


def test_pretty_keeps_what_fits_on_a_line_and_breaks_the_rest():
    assert tc.pretty({"b": [1, 2], "a": 1}) == '{"a": 1, "b": [1, 2]}'
    long = {"k": ["x" * 40, "y" * 40, "z" * 40]}
    text = tc.pretty(long)
    assert text.count("\n") == 6 and text.startswith('{\n  "k": [')
    assert __import__("json").loads(text) == long


# ------------------------------------------------------------------------------ the checks: town


def test_the_checker_passes_the_content():
    assert check(lambda s: None) == []


def test_rows_of_different_widths_are_refused():
    def edit(s):
        rows = town_src(s)["rows"].split("\n")
        rows[3] += "."
        town_src(s)["rows"] = "\n".join(rows)

    assert has(check(edit), "bridge_town", "not all of the same width")


def test_a_character_the_legend_does_not_list_is_refused_with_its_cell():
    def edit(s):
        town_src(s)["rows"] = town_src(s)["rows"].replace("...", "?..", 1)

    assert has(check(edit), "bridge_town", "'?'", "legend does not list")


def test_the_legend_needs_a_building_and_distinct_ids():
    def no_building(s):
        legend = town_src(s)["legend"]
        legend["H"]["id"] = "house"

    assert has(check(no_building), "needs an entry with id 'building'")

    def twin(s):
        town_src(s)["legend"]["#"]["id"] = "river"

    assert has(check(twin), "share an id")


@pytest.mark.parametrize(
    "edit, needles",
    [
        (lambda p: p.update(door=[16, 19]), ("p_market", "not walkable")),
        (lambda p: p.update(stands=[[0, 0]]), ("p_market", "outside the rect")),
        (lambda p: p["stands"].append(list(p["stands"][0])), ("p_market", "distinct")),
        (lambda p: p.update(kind="castle"), ("p_market", "kind 'castle'")),
        (lambda p: p.update(rect=[0, 0, 99, 99]), ("p_market", "not inside the map")),
        (lambda p: p.update(zh=" "), ("p_market", "English name")),
        (lambda p: p.pop("door"), ("p_market", "needs a door")),
    ],
)
def test_a_place_with_a_bad_cell_or_field_is_refused(edit, needles):
    assert has(check(lambda s: edit(place_src(s, "p_market"))), *needles)


def test_an_indoor_place_needs_a_footprint_and_a_door_next_to_it():
    assert has(
        check(lambda s: place_src(s, "p_li_house").update(door=[3, 7], stands=[])),
        "p_li_house",
        "not next to a footprint",
    )
    assert has(
        check(lambda s: place_src(s, "p_school").update(footprints=[])),
        "p_school",
        "needs a footprint",
    )
    assert has(
        check(lambda s: place_src(s, "p_school").update(footprints=[[16, 3, 6, 3]])),
        "p_school",
        "not a building cell",
    )


def test_a_water_place_may_not_be_walked_on_or_have_a_door():
    assert has(
        check(lambda s: place_src(s, "p_under_bridge").update(door=[25, 17])),
        "p_under_bridge",
        "no door",
    )
    assert has(
        check(lambda s: place_src(s, "p_under_bridge").update(rect=[24, 15, 6, 2])),
        "p_under_bridge",
        "can be walked",
    )


def test_a_place_cut_off_from_the_rest_is_refused():
    def edit(s):
        rows = town_src(s)["rows"].split("\n")
        rows[0] = ",#" + rows[0][2:]  # a walkable cell that walls close in
        rows[1] = "#" + rows[1][1:]
        town_src(s)["rows"] = "\n".join(rows)
        market = place_src(s, "p_market")
        market["rect"] = [0, 0, 56, 34]
        market["stands"].append([0, 0])

    assert has(check(edit), "bridge_town", "p_market", "(0, 0) cannot be reached")


def test_place_names_must_agree_with_entities_yaml():
    def edit(s):
        place_src(s, "p_bridge")["en"] = "Old Bridge"

    assert has(check(edit), "p_bridge", "differ from entities.yaml")

    def wrong_type(s):
        place_src(s, "p_bridge")["id"] = "li_da"

    assert has(check(wrong_type), "li_da", "lists this id as a person")


def test_a_duplicate_place_or_a_bad_id_is_refused():
    def twice(s):
        town_src(s)["places"].append(copy.deepcopy(place_src(s, "p_market")))

    assert has(check(twice), "p_market", "duplicate id")

    def bad(s):
        place_src(s, "p_market")["id"] = "market"

    assert has(check(bad), "start with 'p_'")


def test_a_barrier_must_close_what_it_says_and_open_into_something_walkable():
    assert has(
        check(lambda s: town_src(s)["barriers"][0].update(cells=[[55, 19]])),
        "lane_barrier",
        "not closed in the rows",
    )
    assert has(
        check(lambda s: town_src(s)["barriers"][0].update(place="p_nowhere")),
        "lane_barrier",
        "unknown place",
    )
    assert has(
        check(lambda s: town_src(s)["barriers"][0].update(open="#")),
        "must be walkable",
    )
    assert has(
        check(lambda s: town_src(s)["barriers"][0].update(closed=":")),
        "must block",
    )


def test_weather_and_phase_names_must_be_distinct():
    def edit(s):
        town_src(s)["weather"].append(copy.deepcopy(town_src(s)["weather"][0]))

    assert has(check(edit), "weather must list distinct ids")


# ------------------------------------------------------------------------------ the checks: cast


@pytest.mark.parametrize(
    "edit, needles",
    [
        (
            lambda p: p["routine"][1].update(place="p_nowhere"),
            ("li_da", "routine place 'p_nowhere'"),
        ),
        (lambda p: p.update(home="p_under_bridge"), ("li_da", "home 'p_under_bridge'")),
        (lambda p: p["ops"].update(level=99), ("li_da", "add up to 100")),
        (lambda p: p["routine"][0].update(hour=7), ("li_da", "must start at 06:00")),
        (lambda p: p["routine"][2].update(hour=7), ("li_da", "must increase")),
        (lambda p: p["routine"][1].update(act="dance"), ("li_da", "routine act 'dance'")),
        (lambda p: p["routine"][1].update(act="walk"), ("li_da", "for the world to use")),
        (
            lambda p: p["routine"].insert(2, dict(p["routine"][1], hour=9)),
            ("li_da", "repeats work"),
        ),
        (lambda p: p["routine"][-1].update(place="p_teahouse"), ("li_da", "must end at home")),
        (lambda p: p["routine"][-1].update(act="rest"), ("li_da", "ends with sleep")),
        (lambda p: p.update(tags=["boss"]), ("li_da", "tags")),
        (lambda p: p.update(tags=["hub", "hub"]), ("li_da", "tags")),
        (lambda p: p["token"].update(zh="李李"), ("li_da", "token")),
        (lambda p: p["token"].update(en="l"), ("li_da", "token")),
        (
            lambda p: p.update(holdings=[{"item": "gold", "qty": 1}]),
            ("li_da", "unknown item 'gold'"),
        ),
        (
            lambda p: p.update(holdings=[{"item": "bamboo", "qty": 1, "at": "p_nowhere"}]),
            ("li_da", "p_nowhere"),
        ),
        (lambda p: p["traits"].update(gossip=101), ("traits.gossip", "less than or equal to 100")),
        (lambda p: p.update(en="Big Li"), ("li_da", "differ from entities.yaml")),
        (lambda p: p.update(family="fam_zhou"), ("li_da", "family fam_zhou differs")),
        (lambda p: p.update(routine=[]), ("li_da", "routine is empty")),
    ],
)
def test_a_person_with_a_bad_field_is_refused(edit, needles):
    assert has(check(lambda s: edit(person_src(s, "li_da"))), *needles)


def test_the_size_the_ids_and_the_script_are_checked():
    def short(s):
        cast_src(s)["size"] = 21

    assert has(check(short), "size says 21", "lists 20")

    def twice(s):
        cast_src(s)["people"].append(copy.deepcopy(person_src(s, "gengfu")))
        cast_src(s)["size"] = 21

    assert has(check(twice), "listed twice")

    def no_script(s):
        cast_src(s)["script"] = "nothing"

    assert has(check(no_script), "unknown script 'nothing'")

    def clash(s):
        person_src(s, "sishu_xiansheng")["id"] = "t_rail"

    assert has(check(clash), "t_rail", "lists this id as a thing")

    def new_family(s):
        stranger = person_src(s, "zhou_erlang")  # renamed, so that no entity carries the id
        stranger["id"] = "zhou_sanlang"
        stranger["family"] = "fam_nobody"

    assert has(check(new_family), "zhou_sanlang", "unknown family 'fam_nobody'")


def test_everyone_in_the_script_must_be_in_the_cast_and_every_place_on_the_map():
    def drop_person(s):
        people = cast_src(s)["people"]
        people.remove(person_src(s, "miaozhu"))
        cast_src(s)["size"] = len(people)

    assert has(check(drop_person), "miaozhu", "cast of script broken_bridge")

    def drop_place(s):
        town_src(s)["places"].remove(place_src(s, "p_under_bridge"))

    assert has(check(drop_place), "p_under_bridge", "not on the map")


def test_an_entity_without_an_english_label_is_refused():
    def edit(s):
        del s.entities["places"][0]["label_en"]

    assert has(check(edit), "has no English label")


def test_the_cognition_model_can_read_the_tables_and_the_script_from_the_module():
    tables = Tables.from_canon(data.TABLES)
    book = ScriptBook.from_canon(data.SCRIPT)
    assert book.props.check(tables, book.registry) == []
    assert {e.id for e in book.registry.of_type("person")} <= set(PEOPLE)
    assert all(e.label_en for e in book.registry)


# ------------------------------------------------------------------------------ what people like


def test_every_person_has_a_line_of_the_town_in_both_languages_the_things_they_like_and_a_return():
    gifts = {g["id"] for g in SCRIPT["gifts"]}
    for person in CAST["people"]:
        assert set(person["intro"]) == {"zh", "en"} and person["intro"]["zh"]
        assert person["likes"] and set(person["likes"] + person["dislikes"]) <= gifts
        assert person["ask"]["what"] in tc.ASK_KINDS
    assert [g["id"] for g in SCRIPT["gifts"]] == ["tea", "pastry", "lantern_paper", "wine"]


def test_a_person_with_no_line_of_the_town_is_refused():
    def mutate(src: cc.Sources) -> None:
        del person_src(src, "li_da")["intro"]

    assert has(check(mutate), "people.", "intro", "Field required")


@pytest.mark.parametrize(
    ("zh", "en", "needle"),
    [
        ("", "A line.", "intro (zh) is empty"),
        ("李家的人。", "", "intro (en) is empty"),
        ("英文" + "李" * 60, "A line.", "at most 60"),
        ("李家的人。", "A" * 201, "at most 200"),
        ("李家的人；做竹料。", "A line.", "semicolon or a dash"),
        ("李家的人。", "Li Da -- the eldest.", "semicolon or a dash"),
        ("他是李家的人。", "A line.", "he or she"),
        ("李家的人。", "She is of the Li family.", "he or she"),
        ("Li family", "A line.", "must be Chinese"),
        ("李家的人。", "李家的人。", "must be English"),
        ("李家的人。\n又一行", "A line.", "one line"),
    ],
)
def test_the_line_of_the_town_is_held_to_its_limits(zh, en, needle):
    def mutate(src: cc.Sources) -> None:
        person_src(src, "li_da")["intro"] = {"zh": zh, "en": en}

    assert has(check(mutate), "li_da", needle)


@pytest.mark.parametrize(
    ("likes", "dislikes", "needle"),
    [
        (["jade"], [], "not a small thing of the script"),
        (["tea"], ["jade"], "not a small thing of the script"),
        (["tea", "tea"], [], "lists a thing twice"),
        (["tea"], ["tea"], "share a thing"),
        ([], ["wine"], "likes at least one"),
    ],
)
def test_what_a_person_likes_has_to_be_the_small_things_of_the_script(likes, dislikes, needle):
    def mutate(src: cc.Sources) -> None:
        person = person_src(src, "li_da")
        person["likes"], person["dislikes"] = likes, dislikes

    assert has(check(mutate), "li_da", needle)


@pytest.mark.parametrize(
    "ask",
    [
        {"what": "kiss"},
        {"what": "stall"},
        {"what": "stall", "item": "middle"},
        {"what": "stall", "item": "front", "amount": 5},
        {"what": "role", "item": "mayor"},
        {"what": "wage", "amount": 15},
        {"what": "wage", "amount": 10, "item": "x"},
        {"what": "slot", "item": "9"},
        {"what": "slot", "amount": 3},
    ],
)
def test_the_return_a_person_asks_has_to_be_a_promise_the_manager_can_make(ask):
    def mutate(src: cc.Sources) -> None:
        person_src(src, "li_da")["ask"] = ask

    assert has(check(mutate), "li_da", "ask")


def test_the_return_that_is_a_place_in_the_programme_may_name_the_place_or_leave_it_free():
    for ask in ({"what": "slot"}, {"what": "slot", "item": "3"}):

        def mutate(src: cc.Sources, ask: dict = ask) -> None:
            person_src(src, "li_da")["ask"] = ask

        assert check(mutate) == []


def test_the_small_things_of_a_script_are_checked():
    def twice(src: cc.Sources) -> None:
        src.scripts["broken_bridge"]["gifts"].append(dict(src.scripts["broken_bridge"]["gifts"][0]))

    def bad_gain(src: cc.Sources) -> None:
        src.scripts["broken_bridge"]["gifts"][0]["gain"] = 0

    def bad_name(src: cc.Sources) -> None:
        src.scripts["broken_bridge"]["gifts"][0]["en"] = "茶叶"

    def too_many(src: cc.Sources) -> None:
        gifts = src.scripts["broken_bridge"]["gifts"]
        gifts += [{"id": f"x{n}", "zh": "东西", "en": "a thing", "gain": 4} for n in range(9)]

    assert has(check(twice), "gifts", "listed twice")
    assert has(check(bad_gain), "gain")
    assert has(check(bad_name), "gifts", "English")
    assert has(check(too_many), "gifts", "at most")


def test_a_cast_that_names_a_thing_the_script_does_not_have_is_refused_even_with_no_gifts():
    def mutate(src: cc.Sources) -> None:
        src.scripts["broken_bridge"]["gifts"] = []

    assert has(check(mutate), "not a small thing of the script")
