"""The categories the bridge world asks a model under, and the queue class each is meant for."""

import json
import re
import tomllib
from pathlib import Path

from bridge_helpers import CLEAR, bridge

from lantern_core import api
from lantern_core.world.bridge import categories
from lantern_core.world.bridge.world import BridgeWorld

ROOT = Path(__file__).resolve().parents[2]
CLASSES = (1, 2, 3, 4)  # the classes a host has


def test_the_names_are_the_four_kinds_of_asking_with_the_class_of_each():
    assert categories.QUEUE_CLASS == {
        "reply": 1,  # the reply the player waits for
        "prefetch": 2,  # made ahead, near the player
        "director": 3,
        "paper": 3,
        "reflection": 4,  # at night
    }
    named = tuple(categories.QUEUE_CLASS)
    assert named == (
        categories.REPLY,
        categories.PREFETCH,
        categories.DIRECTOR,
        categories.PAPER,
        categories.REFLECTION,
    )
    assert named == categories.CATEGORIES


def test_every_class_of_the_host_has_a_category_and_the_list_goes_in_the_order_of_the_queue():
    classes = [categories.QUEUE_CLASS[name] for name in categories.CATEGORIES]
    assert classes == sorted(classes)
    assert set(classes) == set(CLASSES)
    assert all(type(c) is int for c in classes)


def test_a_name_is_a_bare_key_a_host_can_put_in_its_table_and_none_is_the_m0_name():
    for name in categories.CATEGORIES:
        assert re.fullmatch(r"[a-z][a-z_]*", name), name
    assert len(set(categories.CATEGORIES)) == len(categories.CATEGORIES)
    assert "chatter" not in categories.QUEUE_CLASS  # m0's, which the host classes by default


def test_the_module_lists_what_the_table_holds_and_the_api_names_each_category_and_class():
    rows = re.findall(r"^(\w+)\s+(\d)\s", categories.__doc__ or "", flags=re.MULTILINE)
    assert {name: int(queue_class) for name, queue_class in rows} == categories.QUEUE_CLASS
    doc = api.__doc__ or ""
    assert "lantern_core.world.bridge.categories" in doc
    for name, queue_class in categories.QUEUE_CLASS.items():
        assert f'``"{name}"``' in doc
        assert f"``{name} = {queue_class}``" in doc.replace("\n      ", " ")


def test_the_example_provider_file_agrees_with_the_core_on_every_category_it_lists():
    text = (ROOT / "configs" / "providers.example.toml").read_text(encoding="utf-8")
    listed = tomllib.loads(text).get("classes", {})
    for name, queue_class in listed.items():
        assert queue_class in CLASSES, name
        if name in categories.QUEUE_CLASS:
            assert queue_class == categories.QUEUE_CLASS[name], name


def test_the_bridge_world_asks_under_none_but_these_names():
    world = BridgeWorld()
    assert set(world.results) <= set(categories.CATEGORIES)  # what it knows to land
    game = bridge(3, **CLEAR)
    for _ in range(600):
        out = json.loads(game.step())
        for request in out["requests"]:
            assert request["category"] in categories.QUEUE_CLASS
