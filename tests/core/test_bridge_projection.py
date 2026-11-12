"""What the frame shows the player: the audit of every key and field, and the proof that the new
keys (``tasks``, ``tracked`` and ``cards``) say nothing of what is true in the game.

``projection`` marks each key of the frame and each kind of event as ``known`` (the manager was
shown it, asked for it or can work it out), ``public`` (anyone looking at the map sees it) or
``debug`` (for tools). The first tests hold the audit to real frames: no key without a row, and no
row for a key that is never there. The rest change what is hidden, the variant that is true, what
each person believes, the hops of the rumour the manager has not traced, and compare what the new
keys say.
"""

from __future__ import annotations

import inspect
import json
import re
from pathlib import Path

import bridge_driver
import pytest
from agenda_helpers import frame_now, meet, slice_game
from bridge_helpers import at, bridge, run_to, state_of
from player_helpers import act

import lantern_core.world.bridge as package
from bots.base import Bot, Obs
from lantern_core import canon
from lantern_core.api import Game
from lantern_core.world.bridge import agenda, agenda_terms, clock, projection

ROOT = Path(__file__).resolve().parents[2]
NEW_KEYS = ("tasks", "tracked", "cards", "board")
RUMOUR_HOPS = ("c1", "c2", "c3", "c4", "c5")


# ------------------------------------------------------------------------------ real frames


class Morning(Bot):
    """The first day of the slice, to the afternoon, with talk, a refusal, asks and a lead."""

    name = "morning"

    def play(self):
        if (yield from self.meet("li_laotai")):
            yield from self.entrust("lend")
            yield from self.act("ask", topic="li_er")
            yield from self.act("track", task="t_who_said")
            yield from self.leave()
        yield from self.wait_until(1, 8, 0)
        if (yield from self.meet("cha_laoban")):
            yield from self.act("ask", topic="li_er")
            yield from self.act("ask_source", entry=self.o.notebook[0]["id"])
            yield from self.leave()
        yield from self.wait_until(1, 12, 20)
        if (yield from self.meet("zhou_huoji")):
            for _ in range(3):
                yield from self.act("ask", topic="li_er")
            yield from self.leave()
        yield from self.wait_until(1, 17, 40)
        yield from self.goto("p_teahouse")
        while True:
            yield None


def frames_of_the_slice(until: int = at(1, 18, 30), every: int = 7):
    game = slice_game()
    bot = Morning(json.loads(game.scene_json()), 492)
    obs = Obs(json.loads(game.step("[]")))
    seen = [obs.frame]
    while game.tick < until:
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(game.step(json.dumps(records))))
        if game.tick % every == 0 or action is not None:
            seen.append(obs.frame)
    return seen


def frames_of_a_judged_notebook():
    """The slice with three notes from the clerk, a hint, a judgement and the hint again."""
    game = slice_game()
    run_to(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    seen = []
    for _ in range(3):
        seen.append(act(game, "ask", topic="li_er")["frame"])
    for kind, fields in (
        ("hint", {}),
        ("judge", {"a": "n2", "b": "n1", "relation": "unsupported"}),
        ("hint", {}),
        ("hint", {}),
    ):
        seen.append(act(game, kind, **fields)["frame"])
    assert seen[-1]["judgments"] and seen[-2]["hint"] is not None
    return seen


def frames_of_a_festival_that_has_begun():
    """A game in which some households have promised to come, so that there are lanterns."""
    game = bridge(3, dev_actions=1)
    seen = []
    for npc in ("li_da", "zhou_zhanggui", "cha_laoban"):
        seen.append(act(game, "dev_goal", op="join", npc=npc)["frame"])
    run_to(game, 40)
    seen.append(json.loads(game.step())["frame"])
    return seen


def frames_of_a_watched_festival():
    """A game whose page says that it shows the moments, and in which the first lanterns of both
    banks hang: the frames have the moments and the hold."""
    game = bridge(3, dev_actions=1)
    seen = [act(game, "moment", op="watch")["frame"]]
    for npc in ("li_da", "cha_laoban"):
        seen.append(act(game, "dev_goal", op="join", npc=npc)["frame"])
    seen.append(act(game, "moment", op="release", kind="both_banks")["frame"])
    run_to(game, game.tick + 20)
    seen.append(json.loads(game.step())["frame"])
    return seen


def frames_of_the_morning_after(every: int = 40):
    """The slice from the evening of the first day to the morning after, with the bamboo promised
    (the test action stands in for the persuasion), brought and told in the recap."""
    game = slice_game(dev_actions=1)
    run_to(game, at(1, 18, 20))
    seen = [act(game, "dev_goal", op="material", npc="li_da")["frame"]]
    while game.tick < at(2, 8, 0):
        out = json.loads(game.step())
        frame = out["frame"]
        if game.tick % every == 0 or frame["recap"] or frame["gazette"] or frame["night"]:
            seen.append(frame)
    return seen


def frames_of_the_town(until: int = 2070):
    driver = bridge_driver.Driver(2015, restores=False)
    seen = []
    while driver.game.tick < until:
        _, out = driver.call()
        if driver.game.tick % 5 == 0 or out["frame"]["night"]:
            seen.append(out["frame"])
    return seen


@pytest.fixture(scope="module")
def frames():
    return (
        frames_of_the_slice()
        + frames_of_the_town()
        + frames_of_a_festival_that_has_begun()
        + frames_of_a_watched_festival()
        + frames_of_the_morning_after()
        + frames_of_a_judged_notebook()
    )


def test_every_key_and_field_of_a_real_frame_has_a_mark(frames):
    assert len(frames) > 300
    for frame in frames:
        assert projection.problems(frame) == []
    assert {k for frame in frames for k in frame} >= {
        "npcs", "time", "weather", "bubbles", "dots", "lanterns", "hud", "player", "notebook",
        "ending", "tasks", "tracked", "cards", "commitments", "site", "recap", "board", "gazette",
        "night", "people",
    }  # fmt: skip


def test_every_row_of_the_audit_is_for_a_key_a_real_frame_has_and_so_is_every_field_it_lists(
    frames,
):
    seen = {path for frame in frames for path in projection.paths(frame)}
    # absent when nobody sleeps, loads or waits, and from the moments of the kinds that lack them
    optional = {
        "npcs[].status",
        "player.thinking",
        "moments[].prop",
        "moments[].from",
        "moments[].round",
    }
    for entry in projection.FRAME:
        assert entry.path in seen or entry.path.removesuffix("[]") in seen, entry.path
        for name in entry.fields:
            path = f"{entry.path}.{name}"
            assert path in seen or path in optional or entry.path == "ending", path


def test_the_marks_are_the_three_of_the_audit_and_none_of_the_frame_is_for_debugging_only():
    assert projection.MARKS == ("known", "public", "debug")
    assert {entry.mark for entry in projection.FRAME} == {"known", "public"}
    assert {entry.mark for entry in projection.EVENTS} == {"known", "public", "debug"}
    for entry in (*projection.FRAME, *projection.EVENTS):
        assert entry.en.strip() and entry.zh.strip() and entry.mark in projection.MARKS


def test_the_most_specific_row_marks_a_path_and_a_path_without_a_row_has_no_mark():
    assert (
        projection.mark_of("npcs[].x") == "public"
        and projection.mark_of("notebook[].chain") == "known"
    )
    assert (
        projection.mark_of("dots[].progress") == "public"
        and projection.mark_of("dots[].topic") == "public"
    )
    assert projection.mark_of("hud.bridge.percent") == "known"
    assert projection.mark_of("tasks[].window.place") == "known"
    assert projection.mark_of("cards[].find[].from") == "known"
    assert projection.mark_of("npcs[].secret") is None and projection.mark_of("truth") is None
    assert projection.problems({"npcs": [{"id": "a", "belief": 3}], "variant": "v_boat"}) == [
        "npcs[].belief",
        "variant",
    ]


def test_an_event_is_for_the_player_unless_it_is_a_telling_between_townsfolk():
    shown = [
        {"kind": "told", "speaker": "player", "listener": "li_da"},
        {"kind": "asked"},
        {"kind": "task_changed"},
        {"kind": "dawn"},
    ]
    hidden = [
        {"kind": "told", "speaker": "zhou_huoji", "listener": "cha_laoban", "op": "fill"},
        {"kind": "conflict"},
        {"kind": "street"},
        {"kind": "refused", "code": "x"},
    ]
    assert all(projection.visible(e) for e in shown)
    assert not any(projection.visible(e) for e in hidden)


def test_the_events_the_town_makes_between_its_people_are_the_ones_marked_for_debugging():
    kinds = set()
    driver = bridge_driver.Driver(2015, restores=False)
    while driver.game.tick < 2070:
        _, out = driver.call()
        kinds |= {e["kind"] for e in out["events"] if not projection.visible(e)}
    # ... and what a person thinks over in the night and the errand they go on (the first night
    # is in the 2,070 ticks)
    assert "told" in kinds and kinds <= {
        "told", "conflict", "street", "refused", "reflected", "errand",
    }  # fmt: skip
    assert "reflected" in kinds


# ------------------------------------------------------------------------------ the docs


def test_the_tables_of_the_docstring_are_made_from_the_rows_of_the_audit():
    doc = inspect.getdoc(package) or ""
    for text in (
        projection.table(),
        projection.table(projection.EVENTS, fields=False),
        projection.table(projection.SCENE),
    ):
        assert "\n".join(("    " + line) if line else "" for line in text.splitlines()) in doc


def test_the_notes_of_a_row_fit_the_table():
    for entry in (*projection.FRAME, *projection.SCENE):
        assert len(entry.en) <= 90, entry.path


# ------------------------------------------------------------------------------ the scene


def bios_of(scene: dict) -> dict[str, dict[str, str]]:
    return {person["id"]: person["bio"] for person in scene["cast"]}


def test_the_audit_lists_the_bio_of_a_person_as_public_static_content_of_the_scene():
    scene = json.loads(bridge(1).scene_json())
    assert projection.scene_problems(scene) == []
    seen = set(projection.paths({"cast": scene["cast"]}))
    assert {"cast[].bio", "cast[].bio.zh", "cast[].bio.en"} <= seen
    assert {"cast[].intro", "cast[].intro.zh", "cast[].intro.en"} <= seen
    for path in sorted(seen):
        assert projection.mark_of(path, projection.SCENE) == "public", path
    assert {entry.mark for entry in projection.SCENE} == {"public"}
    assert [entry.path for entry in projection.SCENE] == ["cast[]", "cast[].intro", "cast[].bio"]
    for entry in projection.SCENE:
        assert entry.en.strip() and entry.zh.strip()
        for name in entry.fields:
            assert f"{entry.path}.{name}" in seen, name
    stray = {"cast": [{"id": "x", "bio": {"zh": "a", "en": "b"}, "belief": 3}]}
    assert projection.scene_problems(stray) == ["cast[].belief"]


def test_no_frame_has_a_bio_and_no_row_of_the_frame_lists_one(frames):
    for frame in frames:
        for path in projection.paths(frame):
            assert "bio" not in re.split(r"[.\[\]]+", path), path
    assert not any("bio" in entry.fields or "bio" in entry.path for entry in projection.FRAME)
    assert projection.mark_of("cards[].bio") is None and projection.mark_of("cast[].bio") is None


def test_what_the_town_says_of_a_person_is_the_same_in_every_game():
    """It is content, so neither the seed nor the story that is true changes a word of it."""
    scenes = [json.loads(bridge(seed).scene_json()) for seed in (1, 7, 2015)]
    for variant in ("v_boat", "v_flood", "v_drunk"):
        game = Game(3, "bridge", {"variant": variant})
        scenes.append(json.loads(game.scene_json()))
    first = bios_of(scenes[0])
    assert len(first) == 20 and all(bio["zh"] and bio["en"] for bio in first.values())
    assert all(bios_of(scene) == first for scene in scenes)


# ------------------------------------------------------------------------------ what is hidden


def hidden_changes(state):
    """Ways to change what the game knows and the manager does not, as functions of the world state.

    The variant that is true, what each person believes, how they stand toward each other, the
    hops of the rumour that the manager has not traced (the claims of the opening that the notebook
    does not hold), how far each person trusts the manager, and the street.
    """

    def variant(to):
        return lambda s: s["social"].update(variant=to)

    def forget(person):
        return lambda s: s["social"]["beliefs"][person].clear()

    def swap(a, b):
        def go(s):
            beliefs = s["social"]["beliefs"]
            beliefs[a], beliefs[b] = beliefs[b], beliefs[a]

        return go

    def believe_nothing_of_the_rumour(s):
        for person in ("zhou_zhanggui", "zhou_erlang", "cha_laoban", "zhou_huoji"):
            for prop in list(s["social"]["beliefs"][person]):
                if prop.startswith("pr_li"):
                    del s["social"]["beliefs"][person][prop]

    def another_telling(s):  # the hop from the shopkeeper to the second son, said by someone else
        speaker, listener, rest = s["social"]["claims"]["c2"].split("|", 2)
        s["social"]["claims"]["c2"] = "|".join(("zhou_dalang", listener, rest))

    def trust(s):
        s["player"]["trust"] = [90 - n for n in range(len(s["player"]["trust"]))]

    def bonds(s):
        for person in s["social"]["bonds"]:
            s["social"]["bonds"][person] = [0] * len(s["social"]["bonds"][person])

    def street(s):
        s["crowd"]["enthusiasm"] = [0] * len(s["crowd"]["enthusiasm"])

    return {
        "the truth is the flood": variant("v_flood"),
        "the truth is the elder brother": variant("v_drunk"),
        "the boatman remembers nothing": forget("old_he"),
        "the shopkeeper remembers nothing": forget("zhou_zhanggui"),
        "the boatman and the madam trade their minds": swap("old_he", "cha_laoban"),
        "nobody believes the rumour": believe_nothing_of_the_rumour,
        "another person told the second hop": another_telling,
        "nobody trusts the manager": trust,
        "nobody is fond of anyone": bonds,
        "the street is cold": street,
    }


def what_the_player_is_told(frame):
    return {key: frame[key] for key in NEW_KEYS}


@pytest.fixture(scope="module")
def morning():
    """The slice at the afternoon of the first day, after the morning's route, as a snapshot."""
    game = slice_game()
    bot = Morning(json.loads(game.scene_json()), 492)
    obs = Obs(json.loads(game.step("[]")))
    while game.tick < at(1, 15, 30):
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(game.step(json.dumps(records))))
    return game.snapshot_json()


def test_the_morning_leaves_tasks_and_cards_to_compare(morning):
    base = what_the_player_is_told(frame_now(Game.from_snapshot_json(morning)))
    ids = [t["id"] for t in base["tasks"]]
    assert ids == ["t_bamboo_first", "t_who_said", "t_what_proves", "t_tea_tonight"]
    assert base["tracked"] == "t_bamboo_first"  # blocked, with a trail still to walk
    assert {c["id"] for c in base["cards"]} >= {"li_laotai", "cha_laoban", "zhou_huoji", "li_er"}


@pytest.mark.parametrize("name", list(hidden_changes(None)))
def test_changing_what_is_hidden_changes_nothing_the_frame_tells_of_tasks_and_cards(morning, name):
    base = what_the_player_is_told(frame_now(Game.from_snapshot_json(morning)))
    twin = Game.from_snapshot_json(morning)
    before = canon.digest(state_of(twin))
    hidden_changes(state_of(twin))[name](state_of(twin))
    assert canon.digest(state_of(twin)) != before  # the change was made
    assert what_the_player_is_told(frame_now(twin)) == base


@pytest.mark.parametrize("name", list(hidden_changes(None)))
def test_and_looking_at_the_tasks_again_reads_none_of_it_either(morning, name):
    """The look itself, ``agenda.settle``, from the state with the hidden thing changed."""
    twin, plain_twin = Game.from_snapshot_json(morning), Game.from_snapshot_json(morning)
    hidden_changes(state_of(twin))[name](state_of(twin))
    for each in (twin, plain_twin):
        kernel = each._kernel
        section = kernel.state["world"]["agenda"]
        for row in section["tasks"].values():  # forget what was settled, to settle it again
            if row["state"] not in agenda.ENDED:
                row["state"] = "open"
        env = agenda_terms.Env(kernel.world, kernel.state["world"], clock.at(kernel.state["tick"]))
        agenda.settle(env, section, kernel.state["tick"], None)
    assert state_of(twin)["agenda"] == state_of(plain_twin)["agenda"]
    assert what_the_player_is_told(frame_now(twin)) == what_the_player_is_told(
        frame_now(plain_twin)
    )


def test_the_test_would_notice_if_the_frame_did_read_what_the_player_knows(morning):
    """Changing what the manager knows does move tasks and cards, so the comparison above is no
    comparison of nothing."""
    base = what_the_player_is_told(frame_now(Game.from_snapshot_json(morning)))
    forgot = Game.from_snapshot_json(morning)
    state_of(forgot)["player"]["notebook"].clear()  # the manager's own notebook
    state_of(forgot)["player"]["talked"] = [0] * len(state_of(forgot)["player"]["talked"])
    changed = what_the_player_is_told(frame_now(forgot))
    assert changed["cards"] == [] and base["cards"] != []
    state_of(forgot)["agenda"]["tracked"] = ""
    assert frame_now(forgot)["tracked"] is None and base["tracked"] is not None
    heard = Game.from_snapshot_json(morning)
    state_of(heard)["player"]["trust"][3] = 99  # trust is hidden from the cards, and stays so
    assert what_the_player_is_told(frame_now(heard)) == base


def test_no_card_carries_what_a_person_believes_unless_the_manager_was_told_it(morning):
    twin = Game.from_snapshot_json(morning)
    base = frame_now(twin)["cards"]
    belief = state_of(twin)["social"]["beliefs"]["zhou_dalang"]
    belief["pr_dalang_damaged"] = (
        "assert|90|saw|||0|0|"  # he knows who did it: the manager does not
    )
    cards = frame_now(twin)["cards"]
    assert cards == base and "zhou_dalang" not in {c["id"] for c in cards}
    text = json.dumps(cards, ensure_ascii=False)
    for secret in ("dalang", "v_boat", "v_flood", "v_drunk", "variant"):
        assert secret not in text


def test_the_tasks_say_nothing_of_the_truth_in_any_word(morning):
    base = frame_now(Game.from_snapshot_json(morning))
    text = json.dumps(base["tasks"], ensure_ascii=False)
    for word in (
        "老何",
        "Old He",
        "Boatman",
        "撑船",
        "秋汛",
        "v_boat",
        "v_flood",
        "v_drunk",
        "variant",
    ):
        assert word not in text, word


# ------------------------------------------------------------------------------ the same route


def along_the_morning(variant):
    """What the new keys say after each call of ``Morning`` to the evening, with that story true."""
    game = slice_game(variant=variant)
    bot = Morning(json.loads(game.scene_json()), 492)
    obs = Obs(json.loads(game.step("[]")))
    said = []
    while game.tick < at(1, 18, 30):
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(game.step(json.dumps(records))))
        said.append(what_the_player_is_told(obs.frame))
    return said


@pytest.fixture(scope="module")
def under_the_boatman():
    return along_the_morning("v_boat")


@pytest.mark.parametrize("variant", ["v_flood", "v_drunk"])
def test_the_tasks_and_cards_after_every_call_are_the_same_whichever_story_is_true(
    under_the_boatman, variant
):
    said = along_the_morning(variant)
    assert len(said) == len(under_the_boatman) > 1000
    assert said == under_the_boatman
    assert {task["id"] for told in said for task in told["tasks"]} >= {
        "t_bamboo_first",
        "t_who_said",
        "t_what_proves",
        "t_tea_tonight",
    }
