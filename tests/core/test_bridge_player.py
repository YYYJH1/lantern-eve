"""The festival manager on the grid and in conversation: the walk, the window, the refusals."""

import copy
import json
from types import SimpleNamespace

import pytest
from bridge_helpers import CAST, CLEAR, CYCLE, TOWN, at, bridge, npc_of, run_to, state_of, step
from dealings_helpers import talking
from player_helpers import Bot, ack, act, beside, events, flipped, me, plain, put

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.inputs import InputError
from lantern_core.kernel import Kernel
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import clock, notebook, player, voices

COSTS = {"ask": 10, "ask_source": 10, "tell": 15, "entrust": 20, "promise": 20}

# ------------------------------------------------------------------------------ the walk


def test_the_player_starts_on_the_bridge_and_stands_still():
    game = bridge(1)
    section = me(game)
    assert (section["x"], section["y"]) == TOWN.places["p_bridge"].door == (27, 15)
    assert section["goal"] == [27, 15] and section["talk"] == {} and section["notebook"] == []
    run_to(game, 40)
    assert (me(game)["x"], me(game)["y"]) == (27, 15)


def test_a_walk_to_a_place_goes_one_cell_in_two_ticks_to_its_door_and_ends_with_an_arrival():
    game = bridge(1, **CLEAR)
    out = act(game, "move", place="p_teahouse")
    assert ack(out) == ("applied", None)
    assert out["frame"]["player"]["activity"] == "walk"
    path = [(me(game)["x"], me(game)["y"])]
    arrived = []
    while len(arrived) < 1 and game.tick < 200:
        out = step(game)
        path.append((me(game)["x"], me(game)["y"]))
        arrived += events(out, "arrived")
    door = TOWN.places["p_teahouse"].door
    assert path[-1] == door and arrived[0]["place"] == "p_teahouse"
    assert (arrived[0]["x"], arrived[0]["y"]) == door
    moves = [(a, b) for a, b in zip(path, path[1:], strict=False) if a != b]
    assert all(abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1 for a, b in moves)  # one cell at a time
    # the first step is made on the call that carries the order, then one on every other tick
    assert arrived[0]["tick"] == 2 * len(moves)
    out = step(game)
    assert out["frame"]["player"] == {
        "x": door[0],
        "y": door[1],
        "activity": "rest",
        "talk": None,
        "costs": {**COSTS, "speak": 30},
        "look": [],
        "offers": {"tell": [], "entrust": [], "promise": [], "speak": []},
        "topics": [],
        "thinking": None,
    }
    assert me(game)["dest"] == "" and me(game)["goal"] == list(door)


def test_a_walk_to_a_cell_ends_there_and_the_night_pace_is_one_tick_a_cell():
    game = bridge(2, **CLEAR)
    run_to(game, clock.DAY_TICKS)  # dusk
    out = act(game, "move", x=30, y=15)
    assert ack(out) == ("applied", None)
    ticks = 0
    while (me(game)["x"], me(game)["y"]) != (30, 15):
        step(game)
        ticks += 1
        assert ticks < 20
    assert ticks == 2  # three cells east, a cell on every night tick, the first made on the call
    assert events(step(game), "arrived") == []


def test_a_walk_goes_over_the_bridge_because_the_river_is_the_only_wall():
    game = bridge(3, **CLEAR)
    act(game, "move", place="p_clan_hall")  # across the river from the west and back
    run_to(game, 400)
    assert (me(game)["x"], me(game)["y"]) == TOWN.places["p_clan_hall"].door
    act(game, "move", place="p_li_house")
    run_to(game, 1000)
    assert (me(game)["x"], me(game)["y"]) == TOWN.places["p_li_house"].door


@pytest.mark.parametrize(
    ("fields", "reason"),
    [
        ({"place": "p_nowhere"}, "unknown_place"),
        ({"place": "p_under_bridge"}, "no_door"),
        ({"x": 5000, "y": 5}, "outside"),
        ({"x": 26, "y": 20}, "blocked"),  # the river
        ({"x": 3, "y": 3}, "blocked"),  # a house
    ],
)
def test_a_walk_that_cannot_be_made_is_rejected_for_a_reason_and_changes_nothing(fields, reason):
    game = bridge(1)
    before = json.dumps(me(game), sort_keys=True)
    assert ack(act(game, "move", **fields)) == ("rejected", reason)
    assert json.dumps(me(game), sort_keys=True) == before


def test_a_cell_that_cannot_be_reached_is_rejected(monkeypatch):
    game = bridge(1)
    walled = TOWN.grid
    cut = walled.index(30, 5)
    monkeypatch.setattr(walled, "field", lambda goal: [1 << 30] * len(walled.cost))
    assert walled.walkable(cut)
    assert ack(act(game, "move", x=30, y=5)) == ("rejected", "unreachable")


def test_a_new_order_replaces_the_walk_in_hand_and_a_walk_to_the_spot_arrives_at_once():
    game = bridge(1, **CLEAR)
    act(game, "move", place="p_teahouse")
    run_to(game, 6)
    out = act(game, "move", x=me(game)["x"], y=me(game)["y"])
    assert ack(out) == ("applied", None)
    assert [e["kind"] for e in out["events"] if e["kind"] == "arrived"] == ["arrived"]
    here = (me(game)["x"], me(game)["y"])
    run_to(game, 30)
    assert (me(game)["x"], me(game)["y"]) == here


@pytest.mark.parametrize(
    "body",
    [
        {"type": "move"},
        {"type": "move", "place": "p_teahouse", "x": 3, "y": 3},
        {"type": "move", "x": 3},
        {"type": "move", "x": 3.0, "y": 3},
        {"type": "move", "x": -1, "y": 3},
        {"type": "move", "place": 5},
        {"type": "move", "place": ""},
        {"type": "talk"},
        {"type": "talk", "npc": 3},
        {"type": "ask", "topic": ""},
        {"type": "ask_source"},
        {"type": "look", "at": "x" * 65},
    ],
)
def test_a_malformed_body_is_refused_before_anything_is_applied(body):
    game = bridge(1)
    before = game.snapshot_json()
    with pytest.raises(InputError):
        step(game, {"seq": 0, "kind": "player", "body": {"action_id": "x", **body}})
    assert game.snapshot_json() == before


# ------------------------------------------------------------------------------ a conversation


def chat(seed=1, who="cha_laoban", **config):
    """A game at 08:00 of day 1 with the player next to ``who``, who is awake and at work."""
    game = bridge(seed, **{**CLEAR, **config})
    run_to(game, at(1, 8))
    beside(game, who)
    return game


def test_a_conversation_holds_the_world_and_the_person_where_they_are_until_the_routine_calls():
    game = chat(who="li_da")
    run_to(game, at(1, 12, 55))
    beside(game, "li_da")
    start = game.tick
    here = npc_of(game, "li_da")
    cell = (here["x"], here["y"])
    out = act(game, "talk", npc="li_da")
    assert ack(out) == ("applied", None)
    assert out["clock"] == {"paused": True, "rate": [1, 1]} and out["advanced"] is False
    (opened,) = events(out, "talk_start")
    leaves = {"hour": 13, "minute": 3}  # the routine says home at one, and he is seven ticks late
    assert opened["npc"] == "li_da" and opened["leaves_at"] == leaves
    talk = out["frame"]["player"]["talk"]
    assert {k: talk[k] for k in ("npc", "costs", "leaves_at")} == {
        "npc": "li_da",
        "costs": COSTS,
        "leaves_at": leaves,
    }
    assert set(talk) == {
        "npc", "costs", "leaves_at", "ask_for", "asks_more", "wants", "keep", "give", "queue",
    }  # fmt: skip
    assert out["frame"]["player"]["activity"] == "chat"
    seen = {n["id"]: n for n in out["frame"]["npcs"]}
    assert seen["li_da"]["activity"] == "chat"
    for _ in range(50):  # the world stands still
        assert step(game)["advanced"] is False
    assert game.tick == start and (npc_of(game, "li_da")["x"], npc_of(game, "li_da")["y"]) == cell
    # an act of ten minutes runs the world to five past one, and he is held where he is until
    # the routine calls him, which is three and a half minutes in
    out = act(game, "ask", topic="p_bridge")
    assert out["clock"] == {"paused": False, "rate": [20, 1]}
    ticks = 1
    while me(game)["talk"]:
        assert (npc_of(game, "li_da")["x"], npc_of(game, "li_da")["y"]) == cell
        out = step(game)
        ticks += 1
    assert game.tick == at(1, 13) + 7 and ticks == game.tick - start
    assert events(out, "talk_end") == [
        {"kind": "talk_end", "tick": game.tick - 1, "npc": "li_da", "reason": "timeout"}
    ]
    assert out["clock"] == {"paused": False, "rate": [1, 1]}  # what was left of the ten is let go
    assert me(game)["talk"] == {} and out["frame"]["player"]["talk"] is None
    # the person says they have to go, and the routine goes on
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "li_da"]
    assert said["text"] in voices.variants("li_da", "timeout")
    assert said["until"] == game.tick - 1 + player.LINE_TICKS
    step(game)
    assert npc_of(game, "li_da")["goal"] != list(cell)  # and now the routine sends him home
    run_to(game, game.tick + 200)
    assert (npc_of(game, "li_da")["x"], npc_of(game, "li_da")["y"]) != cell


def test_leaving_ends_the_conversation_at_once_and_the_world_goes_on():
    game = chat()
    act(game, "talk", npc="cha_laoban")
    out = act(game, "leave")
    assert ack(out) == ("applied", None)
    assert events(out, "talk_end")[0]["reason"] == "leave"
    assert out["clock"] == {"paused": False, "rate": [1, 1]} and out["advanced"] is True
    assert me(game)["talk"] == {}
    # the madam is one of the people who carry the days: she has a last word as the manager leaves
    (word,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "cha_laoban"]
    assert word["until"] == out["tick"] + 60 and word["text"]["en"] and word["text"]["zh"]
    assert me(game)["line"][2:4] == ["role", "chat"]
    assert ack(act(game, "leave")) == ("rejected", "not_talking")


def test_a_paused_world_takes_the_players_words_and_a_resume_goes_on_with_what_they_cost():
    game = chat()
    act(game, "talk", npc="cha_laoban")
    until = me(game)["talk"]["until"]
    out = step(game, {"seq": game.next_seq, "kind": "pause", "body": {}})
    assert out["advanced"] is False and out["clock"] == {"paused": True, "rate": [1, 1]}
    tick = game.tick
    for _ in range(5):
        assert step(game)["advanced"] is False
    assert game.tick == tick and me(game)["talk"]["until"] == until
    out = act(game, "ask", topic="p_bridge")  # a paused world still hears the player
    assert ack(out) == ("applied", None) and out["advanced"] is False
    assert out["clock"] == {"paused": True, "rate": [20, 1]}  # and owes the ten minutes
    out = act(game, "leave")
    assert ack(out) == ("applied", None) and out["clock"] == {"paused": True, "rate": [20, 1]}
    out = step(game, {"seq": game.next_seq, "kind": "resume", "body": {}})
    assert out["advanced"] is True and out["clock"] == {"paused": False, "rate": [20, 1]}
    while out["clock"]["rate"] == [20, 1]:
        out = step(game)
    assert game.tick - tick == 20 and out["clock"] == {"paused": False, "rate": [1, 1]}


def test_in_a_conversation_the_player_cannot_walk_or_talk_to_somebody_else():
    game = chat()
    act(game, "talk", npc="cha_laoban")
    at_start = (me(game)["x"], me(game)["y"])
    assert ack(act(game, "move", place="p_bridge")) == ("rejected", "talking")
    assert ack(act(game, "talk", npc="cha_laoban")) == ("rejected", "talking")
    assert ack(act(game, "talk", npc="li_da")) == ("rejected", "talking")
    for _ in range(50):  # the world stands still, and when it runs to pay for an act
        step(game)
    act(game, "ask", topic="p_bridge")
    for _ in range(20):
        step(game)
    assert ack(act(game, "move", place="p_bridge")) == ("rejected", "talking")
    assert (me(game)["x"], me(game)["y"]) == at_start
    act(game, "leave")
    assert ack(act(game, "move", place="p_bridge")) == ("applied", None)


def test_a_player_on_the_way_stops_when_a_conversation_opens():
    game = chat()
    put(game, me(game)["x"] + 1, me(game)["y"])
    act(game, "move", place="p_bridge")
    assert me(game)["goal"] != [me(game)["x"], me(game)["y"]]
    beside(game, "cha_laoban")
    act(game, "talk", npc="cha_laoban")
    assert me(game)["goal"] == [me(game)["x"], me(game)["y"]] and me(game)["dest"] == ""


def test_somebody_asleep_does_not_talk_and_says_so():
    game = bridge(1, **CLEAR)
    run_to(game, 2)
    npc = npc_of(game, "zhou_dalang")
    assert npc["act"] == "sleep"
    beside(game, "zhou_dalang")
    out = act(game, "talk", npc="zhou_dalang")
    assert ack(out) == ("rejected", "asleep")
    assert events(out, "declined") == [
        {"kind": "declined", "tick": 2, "npc": "zhou_dalang", "reason": "asleep"}
    ]
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "zhou_dalang"]
    assert said["text"] in voices.variants("zhou_dalang", "asleep")
    assert said["until"] == 2 + player.LINE_TICKS
    assert out["clock"]["rate"] == [1, 1] and me(game)["talk"] == {}
    run_to(game, game.tick + player.LINE_TICKS + 1)
    assert not [b for b in step(game)["frame"]["bubbles"] if b["npc"] == "zhou_dalang"]


def test_somebody_in_the_middle_of_an_errand_or_a_telling_is_busy():
    game = chat(dev_actions=1)
    errand = {"npc": "cha_laoban", "kind": "goto", "place": "p_market"}
    from lantern_core.world.bridge import tasks

    tasks.assign(game._kernel.world, state_of(game), errand)
    step(game)
    assert npc_of(game, "cha_laoban")["mode"] == "task"
    beside(game, "cha_laoban")
    out = act(game, "talk", npc="cha_laoban")
    assert ack(out) == ("rejected", "busy") and events(out, "declined")[0]["reason"] == "busy"
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "cha_laoban"]
    assert said["text"] in voices.variants("cha_laoban", "busy")
    # in the middle of telling somebody else
    other = chat(seed=2)
    index = CAST.index["cha_laoban"]
    state_of(other)["social"]["busy"][index] = other.tick + 10
    assert ack(act(other, "talk", npc="cha_laoban")) == ("rejected", "busy")
    run_to(other, other.tick + 12)
    beside(other, "cha_laoban")
    assert ack(act(other, "talk", npc="cha_laoban")) == ("applied", None)


def test_only_somebody_within_two_cells_can_be_talked_to():
    game = chat()
    npc = npc_of(game, "cha_laoban")
    put(game, npc["x"] + 3, npc["y"])
    assert ack(act(game, "talk", npc="cha_laoban")) == ("rejected", "far")
    put(game, npc["x"] + 2, npc["y"])
    assert ack(act(game, "talk", npc="cha_laoban")) == ("applied", None)
    assert ack(act(game, "talk", npc="nobody")) == ("rejected", "talking")
    act(game, "leave")
    assert ack(act(game, "talk", npc="nobody")) == ("rejected", "unknown_npc")


def test_the_first_conversation_of_a_day_with_a_person_earns_a_little_trust_to_a_ceiling():
    game = chat()
    index = CAST.index["cha_laoban"]
    assert me(game)["trust"][index] == player.STRANGER_TRUST == 10
    act(game, "talk", npc="cha_laoban")
    assert me(game)["trust"][index] == 13
    act(game, "leave")
    act(game, "talk", npc="cha_laoban")  # the same day: nothing more
    assert me(game)["trust"][index] == 13
    act(game, "leave")
    assert [t for i, t in enumerate(me(game)["trust"]) if i != index] == [10] * 19
    for day in (2, 3, 4, 5):
        run_to(game, at(day, 8))
        beside(game, "cha_laoban")
        act(game, "talk", npc="cha_laoban")
        act(game, "leave")
    assert me(game)["trust"][index] == player.RAPPORT_CEILING == 20


def test_a_conversation_survives_a_snapshot_and_ends_on_the_same_tick():
    game = talking("cha_laoban", hour=11, minute=40)  # she goes at five past noon
    out = act(game, "ask", topic="p_bridge")
    while not out["clock"]["paused"]:
        out = step(game)
    restored = Game.from_snapshot_json(game.snapshot_json())  # in a held conversation
    assert restored.hash() == game.hash() and me(restored)["talk"] == me(game)["talk"]
    assert restored.paused and game.paused
    for topic in ("t_rail", "li_er"):  # the second act runs past the time she goes
        a, b = act(game, "ask", topic=topic), act(restored, "ask", topic=topic)
        while True:
            assert a == b and game.hash() == restored.hash()
            if a["clock"]["paused"] or not me(game)["talk"]:
                break
            a, b = step(game), step(restored)
        if not me(game)["talk"]:
            break
    assert me(restored)["talk"] == {} and me(game)["talk"] == {}
    assert game.tick == restored.tick == at(1, 12) + 10  # the stagger of the madam is ten ticks
    assert clock.rate(state_of(restored)) == (1, 1)


# ------------------------------------------------------------------------------ frame and scene


def test_the_scene_has_a_token_for_the_player_next_to_the_cast():
    scene = json.loads(bridge(1).scene_json())
    assert scene["player"] == {
        "id": "player",
        "zh": "总管",
        "en": "Festival Manager",
        "role": {"zh": "灯会总管", "en": "Manager of the lantern festival"},
        "token": {"zh": "总", "en": "M"},
        "start": [27, 15],
        "things": scene["player"]["things"],
    }
    assert [t["id"] for t in scene["player"]["things"]] == [
        "t_rail",
        "t_he_boat",
        "t_li_er_lantern",
        "t_repair_ledger",
        "t_honor_light",
    ]
    assert scene["player"]["things"][0] == {
        "id": "t_rail",
        "zh": "栏杆",
        "en": "Stone Bridge Railing",
    }
    assert "player" not in [c["id"] for c in scene["cast"]] and len(scene["cast"]) == 20


def verbs_of(game):
    """The verbs of the player, without the one that the call for helpers adds."""
    return [v for v in step(game)["frame"]["hud"]["verbs"] if v != "rally"]


def test_the_verbs_follow_what_the_player_can_do_now():
    game = bridge(2, **CLEAR)
    run_to(game, 2)
    assert verbs_of(game) == ["move", "look"]  # on the bridge, by the rail
    beside(game, "zhou_dalang")  # asleep
    assert "talk" not in verbs_of(game)
    awake = chat(seed=2, who="cha_laoban")
    assert verbs_of(awake)[:2] == ["move", "talk"]
    act(awake, "talk", npc="cha_laoban")
    assert verbs_of(awake) == ["leave", "ask", "tell", "entrust", "promise", "gift"]
    me(awake)["notebook"].append(
        {
            "id": "n1",
            "prop": "pr_liner_damaged",
            "note": "assert|60|heard|cha_laoban|zhou_huoji|2|5|c1",
            "trail": [["cha_laoban", "zhou_huoji", "pr_liner_damaged"]],
        }
    )
    assert verbs_of(awake) == [
        "leave", "ask", "ask_source", "askSource", "tell", "entrust", "promise", "gift",
    ]  # fmt: skip
    act(awake, "leave")
    assert "ask" not in verbs_of(awake)
    assert list(player.VERB_ORDER) == [
        "move", "talk", "leave", "ask", "ask_source", "askSource", "tell", "entrust", "promise",
        "gift", "rally", "speak", "speak_publicly", "listen", "look", "track", "judge", "hint",
    ]  # fmt: skip


def test_the_frame_is_the_players_place_the_notebook_and_the_verbs_in_canonical_json():
    game = bridge(4, **CLEAR)
    text = game.step(json.dumps([{"seq": 0, "kind": "player", "body": {
        "action_id": "m", "type": "move", "place": "p_teahouse"}}]))  # fmt: skip
    assert canon.dumps_str(canon.loads(text)) == text
    frame = json.loads(text)["frame"]
    keys = {"x", "y", "activity", "talk", "costs", "look", "offers", "topics", "thinking"}
    assert set(frame["player"]) == keys
    assert frame["notebook"] == [] and frame["player"]["activity"] == "walk"
    assert [v for v in frame["hud"]["verbs"] if v != "rally"] == ["move", "look"]
    assert frame["player"]["look"] == ["t_rail"]
    plain(game._kernel.state)


# ------------------------------------------------------------------------------ a whole session


@pytest.fixture(scope="module")
def two_days():
    """The bot plays two days: its recording, the hash after every call, every output, the game."""
    game = bridge(5, **CLEAR)
    recorder = Recorder(game)
    hashes: dict[int, str] = {}

    def send(text):
        tick = game.tick
        outputs = recorder.step(text)
        hashes[tick] = game.hash()
        return outputs

    outs = Bot().play(game, 2 * CYCLE, step_with=send)
    return SimpleNamespace(game=game, recording=recorder.recording(), hashes=hashes, outs=outs)


def kinds_of(session):
    found = {}
    for out in session.outs:
        for event in out["events"]:
            found.setdefault(event["kind"], []).append(event)
    return found


def test_a_session_of_walking_talking_listening_asking_and_looking_covers_every_verb(two_days):
    found = kinds_of(two_days)
    for kind in ("arrived", "talk_start", "talk_end", "heard", "asked", "look_start", "inspected"):
        assert found.get(kind), kind
    reasons = {(e["result"], e["reason"]) for e in found["action_ack"]}
    assert ("applied", None) in reasons
    assert {r for _, r in reasons if r} <= {
        "closed", "refused", "asleep", "busy", "far", "nothing_to_hear", "nothing_here",
        "not_talking", "talking",
    }  # fmt: skip
    assert {e["answer"] for e in found["asked"]} >= {"claim", "ignorant"}
    assert {e["path"] for e in found["asked"]} >= {"belief"}


def test_every_text_the_session_showed_is_in_both_languages(two_days):
    def has_chinese(text):
        return any("\u4e00" <= c <= "\u9fff" for c in text)

    seen = 0
    for out in two_days.outs:
        frame = out["frame"]
        texts = [b["text"] for b in frame["bubbles"] if b["text"] is not None]
        texts += [e["text"] for e in frame["notebook"]]
        for text in texts:
            assert set(text) == {"zh", "en"} and has_chinese(text["zh"]) and text["en"].isascii()
            assert text["en"].strip() == text["en"] and text["zh"].strip() == text["zh"]
            seen += 1
    assert seen > 2000


def test_the_page_reads_every_entry_the_session_wrote(two_days):
    order = ["contradicts", "unsupported", "sourceMismatch", "unconfirmed"]
    last = two_days.outs[-1]["frame"]["notebook"]
    assert len(last) >= 5
    for entry in last:
        assert set(entry) == {"id", "text", "source", "at", "marks", "chain"}
        assert entry["marks"] == [m for m in order if m in entry["marks"]]
        source = entry["source"]
        if source["kind"] == "heard":
            assert set(source) <= {"kind", "who", "how", "via"} and "hand" not in source
            assert source["how"] in ("saw", "heard", "unsure") and ("via" in source) == (
                source["how"] == "heard"
            )
            assert set(source["who"]) == {"zh", "en", "id"} and source["who"]["id"] in CAST.index
            assert entry["chain"][0] == source["who"]
        else:
            assert source == {"kind": "seen"} and entry["chain"] == []
        for hop in entry["chain"]:
            assert hop is None or (set(hop) == {"zh", "en", "id"} and hop["id"] in CAST.index)
        assert None not in entry["chain"][:-1]
    ids = [e["id"] for e in last]
    assert ids == [f"n{i}" for i in range(1, len(ids) + 1)]


def test_the_notebook_the_session_kept_holds_together(two_days):
    world_state = state_of(two_days.game)
    section, social = world_state["player"], world_state["social"]
    props = notebook.view(social)
    seen = set()
    for entry in section["notebook"]:
        assert entry["prop"] in props and entry["prop"] not in seen
        seen.add(entry["prop"])
        belief = notebook.belief_of(entry)
        assert belief.holder == "player" and belief.confidence > 0
        if belief.source == "heard":
            assert belief.teller in CAST.index and belief.hop >= 1
            assert belief.claim in social["claims"] or belief.claim in section["claims"]
            assert entry["trail"][0][0] == belief.teller
        else:
            assert belief.source == "saw" and entry["trail"] == []
    for claim_id in section["heard"]:
        assert claim_id in social["claims"]
    for claim_id in section["claims"]:
        claim = notebook.answer(section, claim_id)
        assert claim.listeners == ("player",) and claim.speaker in CAST.index
    assert all(10 <= t <= 20 for t in section["trust"])
    assert section["seq"] == len(section["notebook"]) + 1


def test_replaying_the_inputs_of_the_session_gives_its_state_at_every_tick(two_days):
    replayed = {}
    rebuild(two_days.recording, on_step=lambda g, tick, out: replayed.__setitem__(tick, g.hash()))
    assert replayed == two_days.hashes


def test_a_session_carried_on_from_a_snapshot_or_from_reordered_keys_is_the_same(two_days):
    game = bridge(5, **CLEAR)
    bot = Bot()
    seen = bot.play(game, 3000)
    state = json.loads(game.snapshot_json())
    reordered = Game.__new__(Game)
    reordered._kernel = Kernel.restore(flipped(state))
    for twin in (Game.from_snapshot_json(game.snapshot_json()), reordered):
        assert twin.hash() == game.hash()
        copy_of_bot = copy.deepcopy(bot)
        copy_of_bot.play(twin, 2 * CYCLE, last=seen[-1])
        assert twin.snapshot_json() == two_days.game.snapshot_json()


# ------------------------------------------------------------------------------ anything at all


def sane(game):
    """What must hold whatever the player did."""
    world_state = state_of(game)
    section = world_state["player"]
    grid = TOWN.grid
    assert grid.walkable(grid.index(section["x"], section["y"]))
    assert grid.walkable(grid.index(*section["goal"]))
    talk = section["talk"]
    owed = clock.owed(world_state)
    assert (clock.rate(world_state) == clock.DEBT_RATE) == bool(owed)
    assert game.paused == (bool(talk) and not owed) or game._kernel.state["paused"]
    assert not (talk and section["busy"])
    if talk:
        npc = npc_of(game, talk["npc"])
        assert [npc["x"], npc["y"]] == talk["hold"] or game.tick == talk["start"]
        assert player.distance(section, npc) <= player.TALK_RANGE
        assert game.tick < talk["until"]  # the tick that brings the clock to it ends the talk
    if section["busy"]:
        assert section["goal"] == [section["x"], section["y"]]
    props = [e["prop"] for e in section["notebook"]]
    assert len(set(props)) == len(props)
    assert [e["id"] for e in section["notebook"]] == [f"n{i + 1}" for i in range(len(props))]
    for entry in section["notebook"]:
        assert all(hop[0] in CAST.index for hop in entry["trail"])
    assert all(player.STRANGER_TRUST <= t <= player.RAPPORT_CEILING for t in section["trust"])
    plain(section)


def random_action(rng, game, topics):
    """Any well-formed action at all, valid or not."""
    people = list(CAST.index)
    places = [*TOWN.places, "p_nowhere"]
    section = me(game)
    pick = rng.below(8)
    if pick == 0:
        return "move", {"place": places[rng.below(len(places))]}
    if pick == 1:
        return "move", {"x": rng.below(60), "y": rng.below(36)}
    if pick == 2:
        return "talk", {"npc": people[rng.below(len(people))]}
    if pick == 3:
        return "leave", {}
    if pick == 4:
        return "ask", {"topic": topics[rng.below(len(topics))]}
    if pick == 5:
        ids = [e["id"] for e in section["notebook"]] + ["n99"]
        return "ask_source", {"entry": ids[rng.below(len(ids))]}
    if pick == 6:
        return "listen", {}
    holders = ["t_rail", "p_under_bridge", "t_he_boat", "t_repair_ledger", "p_market", "li_er"]
    return "look", {"at": holders[rng.below(len(holders))]}


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_any_sequence_of_actions_leaves_a_world_that_is_sane(seed):
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.lore import lore

    rng = Pcg32(seed, 77)
    game = bridge(seed, **CLEAR)
    lo = lore()
    topics = sorted(lo.book.props) + sorted(e.id for e in lo.book.registry) + ["pr_nothing"]
    acked = set()
    for _ in range(CYCLE):
        records = []
        if rng.below(6) == 0:
            if rng.below(3) == 0 and not me(game)["talk"]:  # set the player down by somebody
                npc = npc_of(game, list(CAST.index)[rng.below(20)])
                put(game, npc["x"], npc["y"])
            kind, fields = random_action(rng, game, topics)
            body = {"action_id": f"f{game.next_seq}", "type": kind, **fields}
            records = [{"seq": game.next_seq, "kind": "player", "body": body}]
        tick = game.tick
        out = json.loads(game.step(json.dumps(records)))
        acked |= {(e["result"], e["reason"]) for e in out["events"] if e["kind"] == "action_ack"}
        if tick % 41 == 0:
            sane(game)
    sane(game)
    assert ("applied", None) in acked and len(acked) > 8


def test_every_fixed_phrase_has_both_languages_and_two_of_them_join_without_a_gap_in_chinese():
    from lantern_core.world.bridge import phrases

    for code, text in phrases.PHRASES.items():
        assert set(text) == {"zh", "en"} and text["zh"] and text["en"], code
        assert text["zh"].endswith(("。", "）")) and text["en"].endswith((".", ")")), code
    both = phrases.joined(phrases.phrase("not_said"), {"zh": "我亲眼看见。", "en": "I saw it."})
    assert both == {"zh": "我没说过那样的话。我亲眼看见。", "en": "I never said that. I saw it."}
    with pytest.raises(KeyError):
        phrases.phrase("no_such_code")
