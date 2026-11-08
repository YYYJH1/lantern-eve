"""The skeleton of the bridge world: sections, subsystem order, frame, scene, hash, determinism."""

import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import bridge_driver
import pytest
from bridge_helpers import (
    CAST,
    CLEAR,
    CYCLE,
    LIGHT,
    TOWN,
    assign_body,
    at,
    bridge,
    player,
    run_to,
    state_of,
    step,
    world_of,
)

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.inputs import InputError
from lantern_core.kernel import Kernel
from lantern_core.replay import Recorder, rebuild
from lantern_core.world import SCENARIOS, create_world
from lantern_core.world.bridge import clock, order, weather
from lantern_core.world.bridge.world import DEFAULT_CONFIG, FRAME_KEYS, BridgeWorld

TESTS = Path(__file__).resolve().parents[1]
SECTIONS = (
    "clock",
    "weather",
    "npcs",
    "tasks",
    "social",
    "reflection",
    "player",
    "goals",
    "crowd",
    "speech",
    "commitments",
    "agenda",
    "budget",
)
RESERVED: tuple[str, ...] = ()
HUD_KEYS = {"keen", "spent", "held", "cap", "stage", "cloud", "local"}  # crowd and budget
# the keys of their own that the modules add
EXTRA_FRAME_KEYS = {
    "player", "notebook", "ending", "tasks", "tracked", "cards", "judgments", "hint",
    "commitments", "site", "recap", "board", "statement", "gazette", "night",
}  # fmt: skip


# ------------------------------------------------------------------------------ the sections


def test_the_state_is_split_into_the_documented_sections():
    assert order.SECTIONS == SECTIONS and order.RESERVED == RESERVED
    state = state_of(bridge(1))
    assert set(state) == set(SECTIONS)
    assert all(isinstance(state[name], dict) for name in SECTIONS)
    for name in RESERVED:
        assert state[name] == {}  # reserved for the subsystems that fill them
    assert set(state["clock"]) == {"rate"}
    assert set(state["npcs"]) == {"list"} and len(state["npcs"]["list"]) == 20
    assert set(state["tasks"]) == {"next_id", "queue", "done", "jobs", "stock", "worked"}


def test_the_hash_covers_every_section_the_empty_ones_too():
    game = bridge(2)
    run_to(game, 60)
    base = game.hash()
    for name in SECTIONS:
        state_of(game)[name]["probe"] = 1
        assert game.hash() != base, name
        del state_of(game)[name]["probe"]
        assert game.hash() == base, name
    # and the contents of the sections that are in use
    state = state_of(game)
    for change in (
        lambda: state["npcs"]["list"][3].update(x=state["npcs"]["list"][3]["x"] + 1),
        lambda: state["weather"].update(kind="heavy_rain"),
        lambda: state["clock"].update(rate=[1, 3]),
        lambda: state["tasks"]["stock"].setdefault("p_bridge", {}).update(timber=1),
    ):
        before = json.loads(game.snapshot_json())
        change()
        assert game.hash() != base
        state.clear()
        state.update(before["world"])
        assert game.hash() == base


def plain(value, path="$"):
    """Fail on any type that would not survive a snapshot as itself: tuples, sets, floats."""
    if isinstance(value, dict):
        for key, item in value.items():
            assert type(key) is str, (path, key)
            plain(item, f"{path}.{key}")
    elif isinstance(value, list):
        for i, item in enumerate(value):
            plain(item, f"{path}[{i}]")
    else:
        assert value is None or type(value) in (str, int, bool), (path, type(value))


def test_the_state_holds_nothing_but_plain_lists_dicts_strings_ints_and_nulls():
    game = bridge(3, dev_actions=1)
    body = assign_body(
        "a", "li_da", kind="carry", item="bamboo", qty=3, src="p_li_house", dst="p_bridge"
    )
    step(game, player(0, body))
    for tick in (1, 200, 1000, 2100):
        run_to(game, tick)
        plain(game._kernel.state)
        assert json.loads(game.snapshot_json()) == game._kernel.state


# ------------------------------------------------------------------------------ the order


class Spy:
    """A subsystem that says when it is called and otherwise is the module it wraps."""

    def __init__(self, module, log):
        self._module, self._log = module, log
        self.SECTION = module.SECTION

    def init(self, world, rng):
        self._log.append(("init", self.SECTION))
        return self._module.init(world, rng)

    def tick(self, sim):
        self._log.append(("tick", self.SECTION))
        return self._module.tick(sim)

    def __getattr__(self, name):
        return getattr(self._module, name)


def test_the_subsystems_run_in_one_fixed_order():
    assert [m.SECTION for m in order.SUBSYSTEMS] == [
        "clock",
        "weather",
        "tasks",
        "npcs",
        "social",
        "reflection",
        "player",
        "goals",
        "crowd",
        "speech",
        "commitments",
        "agenda",
        "budget",
    ]
    assert [m.__name__.rsplit(".", 1)[1] for m in order.SUBSYSTEMS] == [
        "clock",
        "weather",
        "tasks",
        "npcs",
        "social",
        "reflection",
        "player",
        "goals",
        "crowd",
        "speech",
        "commitments",
        "agenda",
        "budget",
    ]
    assert {m.SECTION for m in order.SUBSYSTEMS} <= set(SECTIONS)


def test_init_and_tick_are_called_once_each_in_that_order(monkeypatch):
    log = []
    monkeypatch.setattr(order, "SUBSYSTEMS", tuple(Spy(m, log) for m in order.SUBSYSTEMS))
    game = bridge(1)
    names = [
        "clock",
        "weather",
        "tasks",
        "npcs",
        "social",
        "reflection",
        "player",
        "goals",
        "crowd",
        "speech",
        "commitments",
        "agenda",
        "budget",
    ]
    assert log == [("init", n) for n in names]
    log.clear()
    for _ in range(3):
        step(game)
    assert log == [("tick", n) for n in names] * 3
    log.clear()
    step(game, {"seq": 0, "kind": "pause", "body": {}})
    step(game)  # a paused world is not ticked
    assert log == []


def without_social(*others):
    """The subsystems without the real ``social`` (and ``others``), for stand-ins to own them."""
    return tuple(m for m in order.SUBSYSTEMS if m.SECTION not in ("social", *others))


def make_social(log):
    """What a later package adds: a module with a section, a tick, an action and a frame hook."""

    def init(world, rng):
        log.append("init social")
        return {"met": 0}

    def tick(sim):
        log.append(f"tick social at {sim.ctx.tick}")
        sim.state["social"]["met"] += 1
        # it runs after npcs: this tick's walking is done
        log.append(f"npc0 at {sim.state['npcs']['list'][0]['x']}")

    def frame(world, state, out):
        out["bubbles"].append({"npc": "li_da", "text": "hello", "until": state["tick"]})
        out["hud"]["met"] = state["world"]["social"]["met"]

    def validate(world, body):
        return {"action_id": body["action_id"], "type": "wave"}

    def apply(sim, body):
        sim.emit("action_ack", action_id=body["action_id"], result="applied", reason=None)

    return SimpleNamespace(
        SECTION="social",
        init=init,
        tick=tick,
        frame=frame,
        ACTIONS={"wave": (validate, apply)},
        CONDITIONS={"always": lambda world, state, cond: True},
        scene=lambda world: {"social_notes": ["x"]},
    )


def test_a_package_plugs_in_with_a_module_and_a_line_and_the_loop_stays_as_it_is(monkeypatch):
    log = []
    monkeypatch.setattr(order, "SUBSYSTEMS", (*without_social(), make_social(log)))
    game = bridge(1)
    assert log == ["init social"]
    out = step(game)
    assert state_of(game)["social"] == {"met": 1}
    assert log[1:] == ["tick social at 0", "npc0 at " + str(state_of(game)["npcs"]["list"][0]["x"])]
    assert out["frame"]["bubbles"] == [{"npc": "li_da", "text": "hello", "until": 1}]
    assert out["frame"]["hud"]["met"] == 1 and set(FRAME_KEYS) <= set(out["frame"])
    out = step(game, player(0, {"action_id": "w1", "type": "wave"}))
    assert [e["result"] for e in out["events"] if e["kind"] == "action_ack"] == ["applied"]
    assert json.loads(game.scene_json())["social_notes"] == ["x"]
    assert world_of(game).holds(game._kernel.state, {"op": "always"}) is True
    # the section is in the hash, and the game restores with the module in place
    assert Game.from_snapshot_json(game.snapshot_json()).hash() == game.hash()


def test_two_packages_cannot_offer_the_same_action_or_the_same_section(monkeypatch):
    base = without_social("goals")
    monkeypatch.setattr(order, "SUBSYSTEMS", (*base, make_social([]), make_social([])))
    with pytest.raises(ValueError, match="distinct"):
        bridge(1)
    other = make_social([])
    other.SECTION = "goals"
    monkeypatch.setattr(order, "SUBSYSTEMS", (*base, make_social([]), other))
    with pytest.raises(ValueError, match="offered twice"):
        bridge(1)


def test_a_section_that_is_not_listed_cannot_be_owned(monkeypatch):
    stray = make_social([])
    stray.SECTION = "gossip"
    monkeypatch.setattr(order, "SUBSYSTEMS", (*order.SUBSYSTEMS, stray))
    with pytest.raises(ValueError, match="distinct state sections"):
        bridge(1)


def test_an_unknown_condition_is_an_error_and_an_unknown_action_is_refused():
    game = bridge(1)
    with pytest.raises(ValueError, match="unknown condition"):
        world_of(game).holds(game._kernel.state, {"op": "nope"})
    with pytest.raises(InputError, match="unknown type"):
        step(game, player(0, {"action_id": "x", "type": "summon"}))
    with pytest.raises(InputError, match="unknown type"):
        step(game, player(0, {"action_id": "x", "type": 5}))


# ------------------------------------------------------------------------------ the frame


def test_the_frame_has_the_keys_of_contract_v1_in_every_call():
    assert FRAME_KEYS == ("npcs", "time", "weather", "bubbles", "dots", "lanterns", "hud")
    game = bridge(4, dev_actions=1)
    body = assign_body(
        "a", "li_da", kind="carry", item="bamboo", qty=3, src="p_li_house", dst="p_bridge"
    )
    step(game, player(0, body))
    scene = json.loads(game.scene_json())
    activities = {a["id"] for a in scene["activities"]}
    statuses = set()
    seen_icons = set()
    talked = False
    for _ in range(CYCLE + 100):
        out = step(game)
        frame = out["frame"]
        assert set(frame) == set(FRAME_KEYS) | EXTRA_FRAME_KEYS
        assert [n["id"] for n in frame["npcs"]] == list(CAST.index)
        for n in frame["npcs"]:
            assert set(n) <= {"id", "x", "y", "activity", "carrying", "status"}
            assert {"id", "x", "y", "activity", "carrying"} <= set(n)
            assert type(n["x"]) is int and type(n["y"]) is int
            assert 0 <= n["x"] < TOWN.width and 0 <= n["y"] < TOWN.height
            assert n["activity"] in activities
            assert n["carrying"] in (None, "bamboo", "timber", "tools")
            seen_icons.add(n.get("status"))
        assert set(frame["time"]) == {"day", "hour", "minute", "phase"}
        assert frame["weather"] in weather.KINDS
        assert frame["lanterns"] == [] and frame["ending"] is None
        for bubble in frame["bubbles"]:  # what is said, and where, is for the social tests
            if bubble["text"] is None:  # a telling beyond the hearing of the manager (F2)
                assert bubble == {"npc": bubble["npc"], "until": bubble["until"], "text": None,
                                  "talking": True}  # fmt: skip
            else:
                assert set(bubble) == {"npc", "until", "text"}
                assert set(bubble["text"]) == {"zh", "en"}
        for dot in frame["dots"]:
            assert set(dot) == {"id", "from", "to", "topic", "progress"}
        talked = talked or bool(frame["bubbles"] and frame["dots"])
        assert set(frame["hud"]) >= HUD_KEYS
        statuses.add(frame["time"]["phase"])
    assert statuses == {"day", "night"} and talked
    assert (
        seen_icons <= {None, "sleep", "load", "umbrella"} and {None, "sleep", "load"} <= seen_icons
    )


def test_the_frame_is_canonical_json_with_ints_only():
    game = bridge(4)
    for _ in range(50):
        text = game.step()
        assert canon.dumps_str(canon.loads(text)) == text


# ------------------------------------------------------------------------------ the scene


def test_the_scene_gives_the_map_layers_the_places_and_the_cast_in_two_languages():
    game = bridge(1)
    scene = json.loads(game.scene_json())
    assert scene["scenario"] == "bridge" and scene["name"] == {"zh": "澄溪镇", "en": "Chengxi Town"}
    assert (scene["width"], scene["height"]) == (TOWN.width, TOWN.height) == (56, 34)
    layers = scene["layers"]
    assert set(layers) == {"terrain", "buildings", "barriers"}
    rows = layers["terrain"]["rows"]
    assert len(rows) == 34 and {len(r) for r in rows} == {56}
    legend = {e["char"]: e for e in layers["terrain"]["legend"]}
    assert set("".join(rows)) <= set(legend)
    assert {e["id"] for e in legend.values()} >= {
        "river",
        "street",
        "lane",
        "grass",
        "wall",
        "building",
    }
    assert all(e["zh"] and e["en"] for e in legend.values())
    assert layers["buildings"] and all(
        set(b) == {"place", "kind", "rect"} for b in layers["buildings"]
    )
    assert layers["barriers"][0]["id"] == "lane_barrier"
    places = {p["id"]: p for p in scene["places"]}
    for wanted in (
        "p_bridge", "p_teahouse", "p_clan_hall", "p_temple", "p_ferry", "p_workshop",
        "p_market", "p_li_house", "p_zhou_house", "p_temple_lane",
    ):  # fmt: skip
        assert wanted in places and places[wanted]["zh"] and places[wanted]["en"], wanted
    assert all(
        set(p) >= {"id", "zh", "en", "kind", "indoor", "rect", "door", "stands", "cells"}
        for p in places.values()
    )
    cast = scene["cast"]
    assert [c["id"] for c in cast] == list(CAST.index) and len(cast) == 20
    for c in cast:
        assert c["zh"] and c["en"] and len(c["token"]["zh"]) == 1 and len(c["token"]["en"]) == 1
        assert set(c) == {"id", "zh", "en", "role", "bio", "token", "family", "home", "work"}
        assert c["role"]["zh"] and c["role"]["en"]
        assert set(c["bio"]) == {"zh", "en"} and c["bio"]["zh"] and c["bio"]["en"]
    assert {c["family"] for c in cast} == {None, "fam_li", "fam_zhou"}
    assert {f["id"]: f["en"] for f in scene["families"]} == {
        "fam_li": "Li Family",
        "fam_zhou": "Zhou Family",
    }
    assert {w["id"] for w in scene["weather"]} == set(weather.KINDS)
    assert scene["time"]["days"] == 5 and scene["time"]["cycle_ticks"] == CYCLE
    assert {a["id"] for a in scene["activities"]} >= {"sleep", "work", "walk", "carry", "shelter"}
    assert [i["id"] for i in scene["items"]] == ["bamboo", "timber", "tools"]


def test_the_scene_is_static_canonical_and_follows_the_config():
    game = bridge(1)
    first = game.scene_json()
    run_to(game, 500)
    assert game.scene_json() == first
    assert canon.dumps_str(canon.loads(first)) == first
    assert bridge(2).scene_json() == first  # the seed does not enter the scene
    assert json.loads(bridge(1, days=7).scene_json())["time"]["days"] == 7


# ------------------------------------------------------------------------------ config and registry


def test_the_scenario_is_registered_next_to_m0_and_the_config_has_its_defaults():
    assert set(SCENARIOS) == {"m0", "bridge"}
    assert isinstance(create_world("bridge"), BridgeWorld)
    assert create_world("m0").name == "m0"
    assert DEFAULT_CONFIG == {
        "days": 5,
        "move_day": 2,
        "move_night": 1,
        "fidget_per_mille": 40,
        "weather_clear": 50,
        "weather_light": 30,
        "weather_heavy": 20,
        "dev_actions": 0,
        "reflect": 1,
        "budget_cap": 3_000_000,
        "price_cheap_in": 150_000,
        "price_cheap_out": 1_500_000,
        "price_strong_in": 800_000,
        "price_strong_out": 8_000_000,
    }
    game = bridge(1)
    assert game.header()["config"] == DEFAULT_CONFIG and game.header()["scenario"] == "bridge"
    assert game.ticks_per_hour == clock.DAY_TICKS_PER_HOUR == 120
    with pytest.raises(ValueError, match="unknown scenario"):
        Game(1, "nowhere")


def test_the_content_hash_covers_the_town_the_cast_the_script_the_clock_and_the_prompts():
    world = world_of(bridge(1))
    assert world.content_hash() == canon.digest(world.content())
    assert set(world.content()) == {
        "scenario",
        "town",
        "cast",
        "cognition",
        "prompts",
        "sentences",
        "speech",
        "clock",
    }
    state = json.loads(bridge(1).snapshot_json())
    assert state["content_hash"] == world.content_hash()
    state["content_hash"] = "0" * 64
    with pytest.raises(ValueError, match="different scenario content"):
        Kernel.restore(state)


# ------------------------------------------------------------------------------ determinism


def continue_to(game, tick):
    hashes = []
    while game.tick < tick:
        game.step()
        hashes.append(game.hash())
    return hashes


def busy_game():
    game = Game(11, "bridge", {"dev_actions": 1})
    script = (
        (
            10,
            assign_body(
                "a1", "li_da", kind="carry", item="bamboo", qty=4, src="p_li_house", dst="p_bridge"
            ),
        ),
        (400, assign_body("a2", "mujiang", kind="work", place="p_bridge", hours=3)),
        (1500, assign_body("a3", "zhadeng_shifu", kind="work", place="p_bridge", hours=4)),
    )
    for seq, (tick, body) in enumerate(script):
        run_to(game, tick)
        step(game, player(seq, body))
    return game


@pytest.mark.parametrize("at_tick", [1800, 2069, 2070, 3000])
def test_a_game_restored_from_a_snapshot_continues_bit_for_bit(at_tick):
    original = busy_game()
    run_to(original, at_tick)
    restored = Game.from_snapshot_json(original.snapshot_json())
    assert restored.hash() == original.hash()
    assert continue_to(restored, 4800) == continue_to(original, 4800)
    assert restored.snapshot_json() == original.snapshot_json()


def flipped(value):
    """The same value with every dict's keys in reverse order. Lists keep theirs."""
    if isinstance(value, dict):
        return {key: flipped(value[key]) for key in reversed(list(value))}
    if isinstance(value, list):
        return [flipped(item) for item in value]
    return value


def test_nothing_depends_on_the_order_of_a_dicts_keys():
    original = busy_game()
    run_to(original, 2500)
    state = json.loads(original.snapshot_json())
    assert list(flipped(state["world"]["tasks"]["stock"])) != list(state["world"]["tasks"]["stock"])
    restored = Game.__new__(Game)
    restored._kernel = Kernel.restore(flipped(state))
    assert restored.hash() == original.hash()
    assert continue_to(restored, 4800) == continue_to(original, 4800)


@pytest.mark.parametrize("hash_seed", ["0", "1", "31337"])
def test_the_run_does_not_depend_on_the_string_hash_seed(hash_seed):
    code = "import json, bridge_driver as d; print(json.dumps(d.run(ticks=2400)['hashes']))"
    env = dict(os.environ, PYTHONHASHSEED=hash_seed)
    env["PYTHONPATH"] = os.pathsep.join([str(TESTS / "cross_host"), str(TESTS / "core")])
    done = subprocess.run(
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
    )
    assert json.loads(done.stdout) == bridge_driver.run(ticks=2400)["hashes"]


def test_replaying_the_input_log_gives_the_state_of_the_live_run_at_every_tick():
    game = Game(12, "bridge", {"dev_actions": 1})
    recorder = Recorder(game)
    assert recorder.snapshot_every == 120
    live = {}
    seq = 0
    while game.tick < 3000:
        tick = game.tick
        records = []
        if tick == 100:
            body = assign_body("a", "li_er", kind="work", place="p_bridge", hours=2)
            records = [player(seq, body)]
            seq += 1
        recorder.step(json.dumps(records))
        live[tick] = game.hash()
    recording = recorder.recording()
    replayed = {}
    rebuild(recording, on_step=lambda g, tick, out: replayed.__setitem__(tick, g.hash()))
    assert replayed == live
    seeked = rebuild(recording, until=2222, seek=True)
    assert seeked.snapshot_json() == rebuild(recording, until=2222).snapshot_json()
    assert seeked.hash() == live[2221]
    assert len(recording["snapshots"]) >= 24


def test_a_paused_world_neither_ticks_nor_moves_and_resumes_where_it_stopped():
    game = bridge(5, **LIGHT)
    run_to(game, at(1, 9))
    before = game.snapshot_json()
    out = step(game, {"seq": 0, "kind": "pause", "body": {}})
    assert out["advanced"] is False and out["clock"]["paused"] is True
    for _ in range(5):
        assert step(game)["advanced"] is False
    after = json.loads(game.snapshot_json())
    assert after["paused"] is True and after["tick"] == json.loads(before)["tick"]
    assert after["world"] == json.loads(before)["world"]
    out = step(game, {"seq": 1, "kind": "resume", "body": {}})
    assert out["advanced"] is True and game.tick == json.loads(before)["tick"] + 1


def test_the_dev_action_is_off_by_default_and_the_weather_levers_are_the_config_weights():
    assert DEFAULT_CONFIG["dev_actions"] == 0
    assert set(CLEAR) == set(LIGHT) == {"weather_clear", "weather_light", "weather_heavy"}
