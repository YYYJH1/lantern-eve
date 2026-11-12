"""Promises made to the manager: what a person agreed to bring, when it falls due, the morning
delivery, the pile at the bridge and the recap of the morning.

The game ``api.preset("slice")`` has the goods that a person agrees to bring promised for a time
and not carried at once (the config ``goods``). The tests play it the way the slice is played: the
manager asks Li Da for the bamboo in the evening of the first day, with the yes forced through the
ordinary path of ``entrust`` (what he needs before he is asked, his mother's nod, his knowing of
the clarification and his trust, is put in by hand, since winning it is the business of
``objection``), and the town goes on to the morning after.
"""

from __future__ import annotations

import json

import pytest
from agenda_helpers import frame_now, meet, slice_game, tasks_of
from bridge_helpers import CAST, at, bridge, run_to, state_of, world_of
from dealings_helpers import believe, trust
from player_helpers import acks, act, events, me, plain

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.kernel import Ctx
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import (
    agenda,
    agenda_terms,
    clarify,
    clock,
    commitments,
    converse,
    entrust,
    objection,
    voices,
)
from lantern_core.world.bridge.sim import Sim
from lantern_core.world.bridge.world import PRESETS

WHY = {"zh": "原因", "en": "reason"}
MORNING = at(2, 6)
DUE = at(2, 7)
LI_DA = "li_da"


class Log:
    """Every event of a game from its first call, each with its number: the state version when it
    was emitted. A signal (``replied``) has none, the state does not count it."""

    def __init__(self) -> None:
        self.version = 0
        self.events: list[tuple[int, dict]] = []

    def feed(self, out: dict) -> dict:
        for event in out["events"]:
            if event["kind"] != "replied":
                self.version += 1
                self.events.append((self.version, event))
        return out

    def of(self, kind: str) -> list[dict]:
        return [e for _, e in self.events if e["kind"] == kind]

    def number(self, event: dict) -> int:
        return next(n for n, e in self.events if e is event)


def start(**config) -> tuple[Game, Log]:
    """The game of the slice at its first call, with a log that sees everything from there."""
    game = slice_game(**config)
    log = Log()
    log.feed(json.loads(game.step()))
    return game, log


def play_to(game: Game, log: Log, tick: int) -> dict:
    """Call until the game stands at ``tick``. The outputs of the last call."""
    out: dict = {}
    while game.tick < tick:
        out = log.feed(json.loads(game.step()))
    return out


def ask(game: Game, log: Log, person: str = LI_DA, nod: bool = True, kind: str = "material"):
    """The manager asks ``person`` for the goods in a talk, and leaves it when they have their
    answer, so that the person is free to go. The outputs of the call that carried the request."""
    meet(game, person)  # the calls that open the talk are not in the log: put its version right
    log.version = game._kernel.state["version"]
    if nod:
        me(game)["nod"]["bamboo"] = game.tick
    believe(game, person, clarify.CLAIM, 90, "saw")  # he knows of the clarification (he was there)
    trust(game, person, 60)
    out = log.feed(act(game, "entrust", kind=kind))
    log.feed(act(game, "leave"))
    return out


def promised_in_the_evening(**config) -> tuple[Game, Log, dict]:
    """The slice at 18:20 of the first day with the bamboo promised: the game, its log and the
    outputs of the call that carried the yes."""
    game, log = start(**config)
    play_to(game, log, at(1, 18, 20))
    return game, log, ask(game, log)


def after(game: Game, log: Log, tick: int) -> list[dict]:
    """The events of the calls until ``tick``, in order."""
    mark = len(log.events)
    play_to(game, log, tick)
    return [e for _, e in log.events[mark:]]


def row_of(game: Game, number: int = 0) -> dict:
    return state_of(game)[commitments.SECTION]["list"][number]


# ------------------------------------------------------------------------------ the config


def test_the_slice_has_its_goods_promised_and_a_game_without_the_key_has_them_at_once():
    assert PRESETS["slice"]["config"]["goods"] == "promised"
    assert commitments.promises_goods(world_of(slice_game()))
    assert "goods" not in bridge(1).header()["config"]
    assert not commitments.promises_goods(world_of(bridge(1)))
    assert not commitments.promises_goods(world_of(bridge(1, goods="at_once")))
    for bad in ("tomorrow", "", 1):
        with pytest.raises(ValueError, match="goods"):
            bridge(1, goods=bad)


def test_a_new_game_has_no_promise_and_nothing_at_the_bridge():
    out = json.loads(slice_game().step())["frame"]
    assert out["commitments"] == [] and out["recap"] is None
    assert out["site"] == {"bamboo": 0, "timber": 0}
    assert state_of(slice_game())[commitments.SECTION] == commitments.init(None, None)


# ------------------------------------------------------------------------------ the promise


def test_a_yes_in_the_evening_is_a_promise_for_seven_the_next_morning_and_nobody_sets_out():
    game, log, out = promised_in_the_evening()
    assert acks(out) == [("applied", None)]
    (entrusted,) = events(out, "entrusted")
    assert (entrusted["npc"], entrusted["request"], entrusted["result"]) == (
        LI_DA,
        "material",
        "agreed",
    )
    (agreed,) = events(out, "agreed")
    assert (agreed["npc"], agreed["what"]) == (LI_DA, "bamboo")
    (made,) = events(out, "commitment")
    assert (made["id"], made["by"], made["state"], made["item"], made["amount"]) == (
        "m1", LI_DA, "promised", "bamboo", 4,
    )  # fmt: skip
    assert state_of(game)["tasks"]["queue"] == []  # nobody carries anything yet
    (row,) = out["frame"]["commitments"]
    assert row == {
        "id": "m1",
        "by": LI_DA,
        "to": "player",
        "what": {"zh": "把四根竹料送到石桥", "en": "Bring 4 poles of bamboo to the Stone Bridge"},
        "item": "bamboo",
        "amount": 4,
        "due": {"day": 2, "hour": 7},
        "state": "promised",
        "reason": None,
    }
    assert row_of(game)["start"] == MORNING and row_of(game)["due_at"] == DUE
    assert out["frame"]["site"] == {"bamboo": 0, "timber": 0}


def test_the_card_of_the_person_lists_the_promise_and_the_task_of_the_promise_appears():
    game, log, out = promised_in_the_evening()
    cards = {c["id"]: c for c in out["frame"]["cards"]}
    assert cards[LI_DA]["agreed"] == ["m1"]
    assert all(c["agreed"] == [] for c in out["frame"]["cards"] if c["id"] != LI_DA)
    tasks = tasks_of(out["frame"])
    assert tasks["t_li_da_promise"]["state"] == "open"
    assert tasks["t_bamboo_first"]["state"] == "open"


def test_the_person_says_the_first_batch_will_come_in_the_morning():
    game, log, out = promised_in_the_evening()
    (bubble,) = [b for b in out["frame"]["bubbles"] if b["npc"] == LI_DA]
    said = voices.variants(LI_DA, "batch_promised")
    assert bubble["text"] in said and len(said) >= 2
    assert "明早" in bubble["text"]["zh"]


def test_a_promise_is_for_the_batch_of_the_script_and_never_for_more_than_the_bridge_lacks():
    assert commitments.rules().batches["bamboo"] == 4
    assert commitments.batch_for("bamboo", 10) == 4
    assert commitments.batch_for("bamboo", 3) == 3
    assert commitments.batch_for("timber", 8) == 8  # no batch for it: all that is lacking


@pytest.mark.parametrize(
    ("hour", "minute", "due"),
    [
        (6, 0, (1, 8)),
        (9, 0, (1, 11)),  # on the hour, two hours later
        (10, 20, (1, 13)),  # a little past it, the hour after
        (14, 59, (1, 17)),
        (15, 0, (2, 7)),  # from three o'clock on, the next morning
        (18, 20, (2, 7)),
        (20, 59, (2, 7)),
    ],
)
def test_a_promise_falls_due_two_hours_on_the_hour_before_three_and_the_next_day_at_seven_after(
    hour, minute, due
):
    assert commitments.due_of(clock.at(at(1, hour, minute))) == due


def test_a_promise_made_at_night_falls_due_in_the_coming_morning():
    # 22:00 and 02:00 of the first game day are both before the dawn of the second
    assert commitments.due_of(clock.at(at(1, 22))) == (2, 7)
    assert commitments.due_of(clock.at(at(1, 2))) == (2, 7)


# ------------------------------------------------------------------------------ the morning


def test_he_sets_out_at_dawn_and_the_bamboo_is_at_the_bridge_before_the_hour_it_was_due():
    game, log, _ = promised_in_the_evening()
    seen = after(game, log, MORNING - 1)
    assert [e["kind"] for e in seen if e["kind"] in ("task_start", "taken", "delivered")] == []
    assert state_of(game)["tasks"]["queue"] == []  # all night, and not a step before
    seen = after(game, log, at(2, 8))
    kinds = [e["kind"] for e in seen if e["kind"] in ("task_start", "taken", "delivered", "recap")]
    assert kinds == ["task_start", "taken", "delivered", "recap"]
    (start_,) = [e for e in seen if e["kind"] == "task_start"]
    (taken,) = [e for e in seen if e["kind"] == "taken"]
    (delivered,) = [e for e in seen if e["kind"] == "delivered"]
    assert start_["tick"] >= MORNING and taken["qty"] == 4 and taken["place"] == "p_li_house"
    assert delivered["tick"] < DUE
    assert (delivered["id"], delivered["item"], delivered["amount"], delivered["place"]) == (
        "m1", "bamboo", 4, "p_bridge",
    )  # fmt: skip
    assert (delivered["npc"], delivered["qty"], delivered["task"]) == (LI_DA, 4, taken["task"])
    row = row_of(game)
    assert (row["state"], row["reason"], row["ended"]) == ("delivered", "", delivered["tick"])


def test_there_is_one_delivery_and_no_event_for_the_promise_other_than_the_making():
    game, log, _ = promised_in_the_evening()
    play_to(game, log, at(3, 6))
    assert [e["state"] for e in log.of("commitment")] == ["promised"]
    assert len(log.of("delivered")) == 1 and len(log.of("agreed")) == 1


def test_the_pile_at_the_bridge_is_what_was_brought_and_the_materials_are_not_complete():
    game, log, _ = promised_in_the_evening()
    out = play_to(game, log, at(2, 8))
    assert out["frame"]["site"] == {"bamboo": 4, "timber": 0}
    assert state_of(game)["tasks"]["stock"]["p_bridge"] == {"bamboo": 4}
    assert "bamboo_delivered" not in state_of(game)["goals"]["flags"]  # the bridge needs ten
    assert out["frame"]["hud"]["bridge"]["lacking"] == "bamboo"
    assert out["frame"]["commitments"][0]["state"] == "delivered"


def test_the_tasks_follow_the_promise_and_the_delivery():
    game, log, _ = promised_in_the_evening()
    for tick in (at(1, 20, 59), MORNING - 1):  # all the evening and the night, and not before dawn
        play_to(game, log, tick)
        assert tasks_of(frame_now(game))["t_li_da_promise"]["state"] == "open"
    play_to(game, log, at(2, 8))
    states = {t["id"]: t["state"] for t in frame_now(game)["tasks"]}
    assert states["t_bamboo_first"] == "done" and states["t_li_da_promise"] == "done"
    assert any(c["cause"] == "done" for c in [e for e in log.of("task_changed")])


def test_the_task_of_the_promise_has_the_time_and_place_of_the_promise_and_no_time_in_its_words():
    """The task is read from the evening of the promise until the bamboo comes. Its window is that
    of the promise, from the hour Li Da sets out to the hour it is due, at the bridge, and its words
    name no time: the same before midnight and after dawn."""
    game, log, out = promised_in_the_evening()
    task = tasks_of(out["frame"])["t_li_da_promise"]
    (row,) = out["frame"]["commitments"]
    assert row["due"] == {"day": 2, "hour": 7}
    assert task["window"] == {"day": 2, "from": 6, "to": 7, "place": "p_bridge"}
    words = (task["why"], task["next"])
    assert not any(t in w["zh"] for w in words for t in ("明早", "今早", "明天", "点"))
    assert not any(t in w["en"] for w in words for t in ("tomorrow", "morning", "by 7"))
    for tick in (at(1, 20, 59), at(1, 23), MORNING - 1, MORNING + 1):  # the evening to the dawn
        play_to(game, log, tick)
        task = tasks_of(frame_now(game))["t_li_da_promise"]
        assert (task["state"], task["why"], task["next"]) == ("open", *words)
        assert task["window"] == {"day": 2, "from": 6, "to": 7, "place": "p_bridge"}


def test_a_promise_made_in_the_day_gives_both_tasks_of_the_bamboo_its_own_hours():
    """A yes at nine is a promise for noon (two hours after the act is over, on the hour), and Li
    Da sets out at once: the window of both tasks is the bridge from nine to twelve that day, as the
    promise says, and not the next morning."""
    game, log = start()
    play_to(game, log, at(1, 9))
    out = ask(game, log)
    (row,) = out["frame"]["commitments"]
    assert row["due"] == {"day": 1, "hour": 12}
    tasks = tasks_of(out["frame"])
    for task_id in (BAMBOO, "t_li_da_promise"):
        assert tasks[task_id]["state"] == "open"
        assert tasks[task_id]["window"] == {"day": 1, "from": 9, "to": 12, "place": "p_bridge"}


BAMBOO = "t_bamboo_first"
ASK_LI_DA = {"verb": "entrust", "npc": LI_DA, "item": "bamboo"}
PROMISED_WHY = {
    "zh": "李大答应把四根竹料送到桥边。",
    "en": "Li Da has promised to bring 4 poles of bamboo to the bridge.",
}
PROMISED_NEXT = {
    "zh": "按约好的时间去桥边，看竹料送到没有。",
    "en": "Be at the bridge at the agreed time and see the bamboo arrive.",
}
AT_THE_BRIDGE = {"day": 2, "from": 6, "to": 7, "place": "p_bridge"}  # the evening promise's window


def granny_li_lets_go(monkeypatch, tick: int = at(1, 18, 5)) -> None:
    """Granny Li withdraws her objection at ``tick``: the clarification that does it is another
    package's, and the task of the bamboo sends the manager to Li Da once it has happened."""
    real = agenda.tick

    def stage(sim):
        if sim.ctx.tick == tick:
            sim.emit("objection_withdrawn", npc="li_laotai", what="bamboo")
        real(sim)

    monkeypatch.setattr(agenda, "tick", stage)


def the_bamboo(frame: dict) -> dict:
    return tasks_of(frame)[BAMBOO]


def test_the_task_of_the_bamboo_says_what_li_da_promised_and_has_nobody_to_ask_until_it_comes(
    monkeypatch,
):
    granny_li_lets_go(monkeypatch)
    game, log = start()
    task = the_bamboo(play_to(game, log, at(1, 18, 20))["frame"])
    assert task["state"] == "open" and task["action"] == ASK_LI_DA  # his mother has let go
    assert task["next"]["zh"] == "请李大把第一批竹料送到桥边。"
    out = ask(game, log)
    task = the_bamboo(out["frame"])
    # the task waits for the morning, so the teahouse, whose evening is on, is the one followed
    assert out["frame"]["tracked"] == "t_tea_tonight" and task["state"] == "open"
    assert (task["why"], task["next"]) == (PROMISED_WHY, PROMISED_NEXT)
    assert task["action"] is None and task["blocker"] is None  # there is no asking him again
    (row,) = out["frame"]["commitments"]  # and it says what the promise says
    assert (row["amount"], row["due"]) == (4, {"day": 2, "hour": 7})
    assert "四根" in task["why"]["zh"] and f"{row['amount']} poles" in task["why"]["en"]
    # the time is not in the words but in the window, which is the promise's: from the hour he sets
    # out to the hour it is due, at the bridge (the promise card says "tomorrow morning" until dawn,
    # then "this morning")
    assert task["window"] == AT_THE_BRIDGE
    assert not any(t in task["why"]["zh"] + task["next"]["zh"] for t in ("明早", "今早", "点"))
    assert not any(t in task["why"]["en"] + task["next"]["en"] for t in ("tomorrow", "by 7"))
    for tick in (at(1, 20, 59), at(1, 23), MORNING - 1, MORNING + 1):  # the evening to the dawn
        play_to(game, log, tick)
        task = the_bamboo(frame_now(game))
        assert (task["state"], task["why"], task["next"], task["action"], task["window"]) == (
            "open", PROMISED_WHY, PROMISED_NEXT, None, AT_THE_BRIDGE,
        )  # fmt: skip
    play_to(game, log, at(2, 8))
    task = the_bamboo(frame_now(game))
    assert (task["state"], task["why"], task["next"], task["action"]) == ("done", None, None, None)


def test_until_li_da_promises_the_task_says_when_and_where_to_find_him(monkeypatch):
    """A manager who did not ask Li Da at the teahouse is told where he is: there until eight, at
    home until nine, and at night the next morning, at home from six until he goes to the market at
    eleven. That is when to go to him again."""
    granny_li_lets_go(monkeypatch)
    game, log = start()
    for (day, hour, minute), window in (
        ((1, 18, 20), {"day": 1, "from": 16, "to": 20, "place": "p_teahouse"}),
        ((1, 20, 30), {"day": 1, "from": 20, "to": 21, "place": "p_li_house"}),
        ((1, 21, 30), {"day": 2, "from": 6, "to": 11, "place": "p_li_house"}),
        ((2, 6, 30), {"day": 2, "from": 6, "to": 11, "place": "p_li_house"}),
    ):
        task = the_bamboo(play_to(game, log, at(day, hour, minute))["frame"])
        assert (task["state"], task["action"], task["window"]) == ("open", ASK_LI_DA, window)


def test_the_task_of_the_bamboo_asks_for_li_da_again_when_the_promise_is_broken(monkeypatch):
    granny_li_lets_go(monkeypatch)
    game, log, _ = promised_in_the_evening(weather_clear=0, weather_light=0, weather_heavy=1)
    play_to(game, log, at(2, 10) - 1)
    assert (
        the_bamboo(frame_now(game))["action"] is None
    )  # three hours past seven, and not yet broken
    play_to(game, log, at(2, 10) + 1)
    assert frame_now(game)["commitments"][0]["state"] == "broken"
    task = the_bamboo(frame_now(game))
    assert task["state"] == "open" and task["action"] == ASK_LI_DA
    assert task["next"]["zh"] == "请李大把第一批竹料送到桥边。" and task["why"] != PROMISED_WHY


def test_the_task_of_the_bamboo_asks_for_li_da_again_when_he_takes_the_promise_back(monkeypatch):
    granny_li_lets_go(monkeypatch)
    game, log, _ = promised_in_the_evening()
    kernel = game._kernel
    assert commitments.withdraw(Sim(kernel.world, Ctx(kernel)), "m1") is True
    play_to(game, log, at(1, 19, 5))  # the next hour: the tasks look again
    task = the_bamboo(frame_now(game))
    assert task["state"] == "open" and task["action"] == ASK_LI_DA
    assert task["why"]["zh"] == "李老太松口了。竹料归李大管。"


def test_the_bamboo_arrives_with_a_word_over_the_head_of_whoever_brought_it_for_a_little_while():
    game, log, _ = promised_in_the_evening()
    said = voices.variants(LI_DA, "bamboo_arrived")
    shown = []
    while game.tick < at(2, 8):
        out = log.feed(json.loads(game.step()))
        if any(b["text"] in said and b["npc"] == LI_DA for b in out["frame"]["bubbles"]):
            shown.append(out["tick"])
    ended = row_of(game)["ended"]
    last = ended + commitments.ARRIVAL_TICKS - 2  # the frame of a call shows the next tick
    assert shown == list(range(ended, last + 1))
    (arrived,) = [e for e in log.of("delivered")]
    assert arrived["tick"] == ended


# ------------------------------------------------------------------------------ the recap


def test_the_recap_comes_once_at_seven_with_the_delivery_and_the_promise_each_pointing_at_events():
    game, log, _ = promised_in_the_evening()
    shown = []
    while game.tick < at(2, 12):
        out = log.feed(json.loads(game.step()))
        if out["frame"]["recap"] is not None:
            shown.append((out["tick"], out["frame"]["recap"]))
    assert [tick for tick, _ in shown] == [DUE]  # one frame, the call that made it
    (made,) = log.of("recap")
    assert made["tick"] == DUE and made["lines"] == 2
    (_, lines) = shown[0]
    assert len(lines) == 2
    delivery, promise = lines
    assert delivery["text"] == {
        "zh": "李大答应的四根竹料，已经送到石桥。",
        "en": "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.",
    }
    assert promise["text"] == {
        "zh": "李大答应送来四根竹料。",
        "en": "Li Da promised to bring 4 poles of bamboo.",
    }
    (made_event,) = log.of("commitment")
    (delivered,) = log.of("delivered")
    assert promise["events"] == [log.number(made_event)]
    assert delivery["events"] == [log.number(made_event), log.number(delivered)]
    for line in lines:  # every number is the number of a real event
        for number in line["events"]:
            assert dict(log.events)[number]["kind"] in ("commitment", "delivered")
    assert log.version == game._kernel.state["version"]


def test_the_recap_is_null_in_the_frames_after_and_is_not_made_before_the_hour():
    game, log, _ = promised_in_the_evening()
    for tick in (at(2, 6, 59), at(2, 7, 1), at(2, 7, 30), at(3, 6)):
        out = play_to(game, log, tick)
        assert out["frame"]["recap"] is None, tick
    assert not any(e["kind"] == "recap" for e in log.of("recap") if e["tick"] != DUE)


def test_a_paused_call_at_the_morning_shows_the_recap_again_and_a_later_call_does_not():
    game, log, _ = promised_in_the_evening()
    play_to(game, log, DUE + 1)
    assert frame_now(game)["recap"] is not None
    play_to(game, log, DUE + 2)
    assert frame_now(game)["recap"] is None


def test_there_is_no_recap_on_the_first_day_and_none_when_nothing_happened():
    game, log = start()
    for tick in (at(1, 7), at(1, 12), at(1, 20)):
        assert play_to(game, log, tick)["frame"]["recap"] is None
    play_to(game, log, at(2, 8))
    assert log.of("recap") == [] and frame_now(game)["recap"] is None
    assert state_of(game)[commitments.SECTION]["recap"]["day"] == 2  # looked, and found nothing


def test_what_the_recap_was_made_from_is_forgotten_and_the_next_day_starts_afresh():
    game, log, _ = promised_in_the_evening()
    play_to(game, log, at(2, 8))
    assert state_of(game)[commitments.SECTION]["journal"] == []
    play_to(game, log, at(3, 8))
    assert state_of(game)[commitments.SECTION]["recap"]["lines"] == []  # a quiet day
    assert len(log.of("recap")) == 1


def test_events_that_other_subsystems_emit_make_the_other_lines_of_the_recap(monkeypatch):
    """``objection_withdrawn`` and ``clarified`` are not emitted by this tree, so the test emits
    them from a subsystem that stands in for the one that does."""
    stage = {
        at(1, 18, 5): ("clarified", {
            "claim": "n1",
            "audience": [
                {"npc": "zhou_huoji", "before": "against", "after": "unsure", "reason": WHY},
                {"npc": "li_laotai", "before": "against", "after": "for", "reason": WHY},
                {"npc": "zuzhang", "before": "unsure", "after": "unsure", "reason": WHY},
            ],
        }),
        at(1, 18, 10): ("objection_withdrawn", {
            "npc": "li_laotai",
            "what": {"zh": "借竹料", "en": "lending the bamboo"},
        }),
    }  # fmt: skip
    real = agenda.tick

    def tick(sim):
        if sim.ctx.tick in stage:
            kind, fields = stage[sim.ctx.tick]
            sim.emit(kind, **fields)
        real(sim)

    monkeypatch.setattr(agenda, "tick", tick)
    game, log = start()
    play_to(game, log, at(1, 18, 20))
    ask(game, log)
    play_to(game, log, at(2, 8))
    (made,) = log.of("recap")
    assert made["lines"] == 3
    lines = state_of(game)[commitments.SECTION]["recap"]["lines"]
    assert [line["text"]["en"] for line in lines] == [
        "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.",
        "Granny Li has given way on lending the bamboo.",
        "Li Da promised to bring 4 poles of bamboo.",
    ]  # the delivery, the person who withdrew an objection, the promise: not the claim set straight
    assert lines[1]["text"]["zh"] == "李老太松口了，答应借竹料。"
    withdrawn = next(e for e in log.of("objection_withdrawn"))
    assert lines[1]["events"] == [log.number(withdrawn)]


def test_a_claim_set_straight_in_public_is_the_line_of_the_people_who_changed_their_minds(
    monkeypatch,
):
    audience = [
        {"npc": "zhou_huoji", "before": "against", "after": "unsure"},
        {"npc": "li_laotai", "before": "against", "after": "for"},
        {"npc": "zuzhang", "before": "unsure", "after": "unsure"},
        {"npc": "cha_laoban", "before": "unsure", "after": "for"},
    ]
    real = agenda.tick

    def tick(sim):
        if sim.ctx.tick == at(1, 18, 5):
            sim.emit("clarified", claim="n1", audience=audience)
        real(sim)

    monkeypatch.setattr(agenda, "tick", tick)
    game, log = start()
    play_to(game, log, at(2, 8))
    (line,) = state_of(game)[commitments.SECTION]["recap"]["lines"]
    assert line["text"] == {
        "zh": "你当众讲明，那话传过了头。周家伙计、李老太、茶馆老板娘听了，改了口。",
        "en": (
            "You told everyone the talk had gone too far. Zhou's Clerk, Granny Li and "
            "Teahouse Keeper changed their minds."
        ),
    }
    assert line["events"] == [log.number(log.of("clarified")[0])]


def test_a_claim_that_changed_nobody_is_no_line():
    stay = [{"npc": "zuzhang", "before": "unsure", "after": "unsure"}]
    journal = [[7, "clarified", 900, {"audience": stay}]]
    assert commitments._lines(world_of(slice_game()), journal) == []


def test_the_recap_has_three_lines_at_most_and_prefers_a_kind_it_has_not_got_yet():
    world = world_of(slice_game())

    def delivered(n, tick, item="bamboo", promise_id=None):
        note = {"id": promise_id or f"m{n}", "npc": LI_DA, "item": item, "amount": 4}
        return [n, "delivered", tick, note | {"place": "p_bridge"}]

    def promise(n, tick):
        return [n, "commitment", tick, {"id": f"m{n}", "by": LI_DA, "item": "bamboo", "amount": 4}]

    def withdrawn(n, tick, npc="li_laotai"):
        return [n, "objection_withdrawn", tick, {"npc": npc}]

    # two deliveries and two promises: one of each kind first, the newest, and the second delivery
    # with the room that is left (a kind that has nothing, a stance here, gives its place up)
    journal = [
        promise(3, 10),
        delivered(5, 20, promise_id="m3"),
        delivered(8, 30, "timber"),
        promise(9, 40),
    ]
    lines = commitments._lines(world, journal)
    assert [line["events"][-1] for line in lines] == [
        5,
        8,
        9,
    ]  # in the order of the events within a kind
    assert [line["text"]["en"] for line in lines] == [
        "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.",
        "The 4 poles of timber that Li Da promised have reached the Stone Bridge.",
        "Li Da promised to bring 4 poles of bamboo.",
    ]
    assert lines[0]["events"] == [3, 5] and lines[1]["events"] == [
        8
    ]  # the promise it kept, if known
    # nothing at all
    assert commitments._lines(world, []) == []
    # a stance and nothing else
    (only,) = commitments._lines(world, [withdrawn(4, 9)])
    assert only["text"]["en"] == "Granny Li has given way."
    assert only["events"] == [4]
    # five withdrawals: three lines, the newest of them first within the kind
    people = ("li_laotai", "li_da", "zuzhang", "cha_laoban", "gengfu")
    many = [withdrawn(n, n, p) for n, p in enumerate(people, 1)]
    assert [line["events"] for line in commitments._lines(world, many)] == [[3], [4], [5]]


# ------------------------------------------------------------------------------ same day


def test_a_yes_before_three_falls_due_the_same_day_and_the_bamboo_is_brought_at_once():
    game, log = start()
    play_to(game, log, at(1, 10, 20))
    out = ask(game, log)
    (row,) = out["frame"]["commitments"]
    assert row["due"] == {"day": 1, "hour": 13} and row["state"] == "promised"
    # he is sent when the act is over (twenty minutes, forty ticks), not in the morning
    assert row_of(game)["start"] == row_of(game)["made"] + 40
    seen = after(game, log, at(1, 13))
    (delivered,) = [e for e in seen if e["kind"] == "delivered"]
    assert delivered["id"] == "m1" and delivered["tick"] < at(1, 13)
    assert row_of(game)["state"] == "delivered"
    assert frame_now(game)["site"]["bamboo"] == 4
    assert [e["kind"] for e in seen if e["kind"] == "commitment"] == []


def test_a_yes_at_ten_to_three_is_made_when_the_act_is_over_and_falls_due_the_next_morning():
    """The request takes twenty minutes and the world pays for them before the promise is made: it
    is ten past three then, after the cutoff. Counted from the start of the act it would be the same
    afternoon."""
    game, log = start()
    play_to(game, log, at(1, 14, 50))
    out = ask(game, log)
    (row,) = out["frame"]["commitments"]
    started = clock.at(row_of(game)["made"])
    assert (started.hour, started.minute // 10) == (14, 5)
    assert commitments.due_of(started) == (1, 17)
    assert row["due"] == {"day": 2, "hour": 7} and row["state"] == "promised"
    assert row_of(game)["start"] == commitments.tick_of(2, 6)  # and he sets out at dawn
    (bubble,) = [b for b in out["frame"]["bubbles"] if b["npc"] == LI_DA]
    assert bubble["text"] in voices.variants(LI_DA, "batch_promised")  # and says it is for tomorrow


def test_a_yes_at_ten_to_eleven_is_due_at_two_since_it_is_made_at_ten_past():
    game, log = start()
    play_to(game, log, at(1, 10, 50))
    out = ask(game, log)
    (row,) = out["frame"]["commitments"]
    started = clock.at(row_of(game)["made"])
    assert (started.hour, started.minute // 10) == (10, 5)
    assert commitments.due_of(started) == (1, 13)  # from the start of the act
    assert row["due"] == {"day": 1, "hour": 14}  # from its end: ten past eleven, two hours on


def test_a_same_day_batch_is_what_the_batch_is_and_the_recap_of_the_next_morning_tells_it():
    game, log = start()
    play_to(game, log, at(1, 10, 20))
    ask(game, log)
    play_to(game, log, at(2, 8))
    (made,) = log.of("recap")
    assert made["lines"] == 2
    assert state_of(game)[commitments.SECTION]["recap"]["day"] == 2


# ------------------------------------------------------------------------------ save and restore


def test_a_game_restored_between_the_promise_and_the_delivery_delivers_once():
    """T13. The game is carried over in the night, and again on the road with the bamboo in hand."""
    game, log, _ = promised_in_the_evening()
    twin, twin_log, _ = promised_in_the_evening()
    play_to(game, log, at(1, 22))
    restored = Game.from_snapshot_json(game.snapshot_json())
    assert restored.hash() == game.hash()
    assert row_of(restored)["state"] == "promised" and row_of(restored)["task"] == 0
    # the twin never leaves; the other is carried over twice
    play_to(twin, twin_log, at(2, 8))
    out_log = Log()
    out_log.version = log.version
    while restored.tick < at(2, 8):
        if (
            json.loads(restored.snapshot_json())["world"]["tasks"]["queue"]
            and restored.tick % 7 == 0
        ):
            restored = Game.from_snapshot_json(restored.snapshot_json())  # again, on the road
        out_log.feed(json.loads(restored.step()))
    assert len(out_log.of("delivered")) == 1 and len(twin_log.of("delivered")) == 1
    assert restored.hash() == twin.hash()
    assert restored.snapshot_json() == twin.snapshot_json()
    assert frame_now(restored)["site"] == {"bamboo": 4, "timber": 0}
    assert row_of(restored)["state"] == "delivered"


def test_a_game_restored_after_the_delivery_does_not_deliver_again_or_make_the_recap_twice():
    game, log, _ = promised_in_the_evening()
    play_to(game, log, at(2, 6, 50))
    restored = Game.from_snapshot_json(game.snapshot_json())
    seen = Log()
    seen.version = game._kernel.state["version"]
    while restored.tick < at(3, 8):
        seen.feed(json.loads(restored.step()))
    assert seen.of("delivered") == [] and len(seen.of("recap")) == 1
    assert frame_now(restored)["site"]["bamboo"] == 4


# ------------------------------------------------------------------------------ broken


def test_a_promise_not_kept_three_hours_after_it_fell_due_is_broken_and_the_rain_is_the_reason():
    game, log, _ = promised_in_the_evening(weather_clear=0, weather_light=0, weather_heavy=1)
    before = json.loads(json.dumps(me(game)))
    seen = after(game, log, at(2, 10) + 1)
    assert [e["kind"] for e in seen if e["kind"] == "delivered"] == []
    (broken,) = [e for e in seen if e["kind"] == "commitment"]
    assert (broken["id"], broken["by"], broken["state"], broken["reason"]) == (
        "m1",
        LI_DA,
        "broken",
        "rain",
    )
    assert broken["tick"] == at(2, 10)  # three hours after seven
    (row,) = frame_now(game)["commitments"]
    assert row["state"] == "broken"
    assert row["reason"] == {
        "zh": "下大雨，货运不出来",
        "en": "The heavy rain kept the goods off the road",
    }
    assert frame_now(game)["site"]["bamboo"] == 0
    tasks = tasks_of(frame_now(game))
    assert (
        tasks["t_li_da_promise"]["state"] == "stale" and tasks["t_bamboo_first"]["state"] == "open"
    )
    # not a broken pledge of the manager: nothing of theirs moved, and nobody holds it against them
    kept = me(game)
    assert kept["pledges"] == [] and kept["caught"] == before["caught"]
    assert not any(e["kind"] in ("pledge_broken", "lie_caught") for e in seen)
    assert (
        kept["trust"] == before["trust"]
        or kept["trust"][CAST.index[LI_DA]] == before["trust"][CAST.index[LI_DA]]
    )


def test_the_errand_that_fails_breaks_the_promise_at_once_and_says_so():
    game, log, _ = promised_in_the_evening()
    state_of(game)["tasks"]["stock"]["p_li_house"]["bamboo"] = 2  # there is not enough to carry
    seen = after(game, log, at(2, 8))
    (broken,) = [e for e in seen if e["kind"] == "commitment"]
    assert broken["state"] == "broken" and broken["reason"] == "failed"
    assert broken["tick"] < DUE and [e for e in seen if e["kind"] == "delivered"] == []
    assert frame_now(game)["commitments"][0]["reason"]["en"].startswith("Something went wrong")
    assert frame_now(game)["site"]["bamboo"] == 0


def test_a_promise_that_is_just_late_is_broken_for_that_and_a_late_arrival_is_an_errand_like_any():
    game, log, _ = promised_in_the_evening()
    row_of(game)["late_at"] = MORNING + 20  # he cannot be at the bridge in ten minutes
    seen = after(game, log, MORNING + 21)
    (broken,) = [e for e in seen if e["kind"] == "commitment"]
    assert (broken["state"], broken["reason"]) == ("broken", "late")
    seen = after(game, log, at(2, 8))
    (arrived,) = [e for e in seen if e["kind"] == "delivered"]
    assert "id" not in arrived and arrived["qty"] == 4  # nothing of the promise any more
    assert row_of(game)["state"] == "broken" and frame_now(game)["site"]["bamboo"] == 4
    assert len(log.of("commitment")) == 2  # made, and broken: nothing more


def test_a_promise_is_taken_back_only_before_the_person_has_set_out():
    game, log, _ = promised_in_the_evening()
    kernel = game._kernel
    sim = Sim(kernel.world, Ctx(kernel))
    assert commitments.withdraw(sim, "m9") is False
    assert commitments.withdraw(sim, "m1") is True
    assert commitments.withdraw(sim, "m1") is False  # not open any more
    assert row_of(game)["state"] == "withdrawn" and row_of(game)["reason"] == "taken_back"
    (event,) = [e for e in sim.ctx.events if e["kind"] == "commitment"]
    assert (event["state"], event["reason"]) == ("withdrawn", "taken_back")
    out = play_to(game, log, at(2, 8))
    assert tasks_of(out["frame"])["t_li_da_promise"]["state"] == "stale"
    assert state_of(game)["tasks"]["queue"] == [] and out["frame"]["site"]["bamboo"] == 0
    # and not after
    second, log2, _ = promised_in_the_evening()
    play_to(second, log2, MORNING + 5)
    assert row_of(second)["task"] != 0
    sim2 = Sim(second._kernel.world, Ctx(second._kernel))
    assert commitments.withdraw(sim2, "m1") is False and row_of(second)["state"] == "promised"


# ------------------------------------------------------------------------------ the pledges


def test_the_promises_of_the_manager_are_not_the_promises_made_to_them():
    game, log = start()
    play_to(game, log, at(1, 18, 20))
    meet(game, LI_DA)
    pledge = act(game, "promise", what="stall", item="front", due=2)
    assert acks(pledge) == [("applied", None)]
    (open_pledge,) = pledge["frame"]["hud"]["pledges"]
    assert open_pledge["id"] == "k1" and open_pledge["to"]["id"] == LI_DA
    out = ask(game, log)
    assert [p["id"] for p in out["frame"]["hud"]["pledges"]] == ["k1"]  # still theirs alone
    assert [c["id"] for c in out["frame"]["commitments"]] == ["m1"]
    kept = json.dumps(me(game)["pledges"], sort_keys=True)
    seen = after(game, log, at(2, 12))
    assert json.dumps(me(game)["pledges"], sort_keys=True) == kept  # the delivery did not touch it
    assert [e["kind"] for e in seen if e["kind"].startswith("pledge")] == []
    # and the pledge breaks the way it always did, on the day after it was due
    seen = after(game, log, at(3, 7))
    assert [e["pledge"] for e in seen if e["kind"] == "pledge_broken"] == ["k1"]
    assert row_of(game)["state"] == "delivered"  # which the broken pledge does not undo


def test_a_promise_that_breaks_leaves_the_pledge_of_the_manager_open():
    game, log = start(weather_clear=0, weather_light=0, weather_heavy=1)
    play_to(game, log, at(1, 18, 20))
    meet(game, LI_DA)
    act(game, "promise", what="stall", item="front", due=2)
    ask(game, log)
    seen = after(game, log, at(2, 12))
    assert [e["state"] for e in seen if e["kind"] == "commitment"] == ["broken"]
    assert [p["state"] for p in me(game)["pledges"]] == ["open"]
    assert not any(e["kind"] == "pledge_broken" for e in seen)


# ------------------------------------------------------------------------------ the other paths


def test_the_yes_of_the_old_woman_is_a_nod_and_no_promise_since_the_bamboo_is_her_sons_to_bring():
    game, log = start()
    play_to(game, log, at(1, 18, 20))
    meet(game, "li_laotai")
    trust(game, "li_laotai", 60)
    believe(game, "li_laotai", clarify.CLAIM, 90, "saw")  # she took the clarification in
    out = log.feed(act(game, "entrust", kind="lend"))
    assert acks(out) == [("applied", None)]
    assert not events(out, "commitment") and not events(out, "agreed")
    assert "bamboo" in me(game)["nod"] and state_of(game)[commitments.SECTION]["list"] == []
    assert state_of(game)["tasks"]["queue"] == []
    (bubble,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "li_laotai"]
    assert bubble["text"] in voices.variants("li_laotai", "will_do")  # not the line of the batch
    assert bubble["text"] not in voices.variants("li_laotai", "batch_promised")


def test_the_timber_is_promised_whole_and_the_bamboo_not_again_while_the_promise_is_open():
    game, log = start()
    play_to(game, log, at(1, 18, 20))
    ask(game, log, "zhou_zhanggui", nod=False)
    (timber,) = frame_now(game)["commitments"]
    assert (timber["by"], timber["item"], timber["amount"]) == ("zhou_zhanggui", "timber", 8)
    assert timber["what"]["en"] == "Bring 8 poles of timber to the Stone Bridge"
    ask(game, log)
    assert [c["item"] for c in frame_now(game)["commitments"]] == ["timber", "bamboo"]
    # the same man asked again while his promise is open says he has said so
    meet(game, LI_DA)
    state_of(game)["player"]["asked"].clear()
    out = act(game, "entrust", kind="material")
    assert acks(out) == [("rejected", "said_already")]
    assert len(frame_now(game)["commitments"]) == 2
    log.feed(act(game, "leave"))  # a conversation holds the world: it runs once the manager leaves
    play_to(game, log, at(2, 8))
    assert frame_now(game)["site"] == {"bamboo": 4, "timber": 8}
    assert "timber_delivered" in state_of(game)["goals"]["flags"]  # all the timber the bridge needs


def test_the_test_action_for_the_materials_makes_the_promise_in_a_game_that_has_them_promised():
    game, log = start(dev_actions=1)
    play_to(game, log, at(1, 12))
    out = act(game, "dev_goal", op="material", npc=LI_DA)
    assert acks(out) == [("applied", None)]
    assert [c["state"] for c in out["frame"]["commitments"]] == ["promised"]
    assert acks(act(game, "dev_goal", op="material", npc=LI_DA)) == [("rejected", "no_change")]


def test_batches_follow_batches_until_the_bridge_has_all_the_bamboo_it_needs():
    game, log = start(dev_actions=1)
    amounts = []
    for hour in (7, 10, 13):  # three mornings and noons of the first day, each promise kept in time
        play_to(game, log, at(1, hour))
        out = act(game, "dev_goal", op="material", npc=LI_DA)
        amounts.append(out["frame"]["commitments"][-1]["amount"])
        play_to(game, log, at(1, hour + 2, 55))
    assert amounts == [4, 4, 2]  # ten in all
    assert frame_now(game)["site"]["bamboo"] == 10
    assert "bamboo_delivered" in state_of(game)["goals"]["flags"]
    assert acks(act(game, "dev_goal", op="material", npc=LI_DA)) == [("rejected", "no_change")]


# ------------------------------------------------------------------------------ the old way


def test_a_game_that_carries_its_goods_at_once_still_does_and_has_a_pile_to_show_for_it():
    game = bridge(3, dev_actions=1)
    run_to(game, 130)
    out = act(game, "dev_goal", op="material", npc=LI_DA)
    assert acks(out) == [("applied", None)]
    assert out["frame"]["commitments"] == [] and [
        t["kind"] for t in state_of(game)["tasks"]["queue"]
    ] == ["carry"]
    run_to(game, 700)
    assert frame_now(game)["site"]["bamboo"] == 10
    assert "bamboo_delivered" in state_of(game)["goals"]["flags"]
    assert frame_now(game)["recap"] is None


def test_the_section_and_the_frame_are_plain_values():
    game, log, _ = promised_in_the_evening()
    play_to(game, log, at(2, 8))
    plain(state_of(game)[commitments.SECTION])
    plain(frame_now(game)["commitments"])
    plain(frame_now(game)["site"])


# ----------------------------------------------------------------------------- the script rules


@pytest.fixture
def script_rules(monkeypatch):
    """A way to change the ``commitments`` of the script for one test and put the rules back."""

    def change(**changes):
        raw = json.loads(json.dumps(commitments.SCRIPT["commitments"]))
        for key, value in changes.items():
            raw[key] = value
        monkeypatch.setitem(commitments.SCRIPT, "commitments", raw)
        commitments.rules.cache_clear()

    yield change
    monkeypatch.undo()
    commitments.rules.cache_clear()


def test_the_first_batch_is_read_from_the_script_and_is_four_when_the_script_says_nothing(
    script_rules,
):
    script_rules(batches={"bamboo": 6})
    assert commitments.batch_for("bamboo", 10) == 6
    script_rules(batches={})
    assert commitments.batch_for("bamboo", 10) == 4 == commitments.FIRST_BATCH["bamboo"]
    script_rules(batches={"timber": 3})
    assert commitments.batch_for("timber", 8) == 3 and commitments.batch_for("bamboo", 10) == 4


def test_the_two_rules_of_the_due_time_are_in_the_script(script_rules):
    script_rules(due={"cutoff": 12, "soon": 3, "late": 8})
    assert commitments.due_of(clock.at(at(1, 9, 30))) == (
        1,
        13,
    )  # before noon: three hours, on the hour
    assert commitments.due_of(clock.at(at(1, 12))) == (2, 8)  # from noon on: eight the next morning


def test_the_words_of_the_script_are_filled_in_both_languages_with_a_name_in_each():
    said = commitments.fill(
        {"zh": "{who}送{amount}根{item}", "en": "{who} brings {amount} poles of {item}"},
        who={"zh": "李大", "en": "Li Da"},
        amount=4,
        item={"zh": "竹料", "en": "bamboo"},
    )
    assert said == {"zh": "李大送四根竹料", "en": "Li Da brings 4 poles of bamboo"}


# ----------------------------------------------------------------------------- event numbers


def test_an_event_is_numbered_by_the_state_version_and_a_signal_has_no_number():
    game = slice_game()
    kernel = game._kernel
    before = kernel.state["version"]
    ctx = Ctx(kernel)
    sim = Sim(kernel.world, ctx)
    sim.emit("first")
    sim.signal("replied", npc="li_da")
    sim.emit("second")
    assert [(n, e["kind"]) for n, e in commitments.numbered(sim)] == [
        (before + 1, "first"),
        (before + 2, "second"),
    ]
    assert kernel.state["version"] == before + 2


def test_looking_at_the_same_events_twice_takes_them_in_once():
    game, log, _ = promised_in_the_evening()
    kernel = game._kernel
    sim = Sim(kernel.world, Ctx(kernel))
    sim.emit("commitment", id="m7", by=LI_DA, state="promised", item="bamboo", amount=4)
    commitments.observe(sim)
    commitments.observe(sim)
    journal = state_of(game)[commitments.SECTION]["journal"]
    assert [row[3]["id"] for row in journal] == ["m1", "m7"]
    assert state_of(game)[commitments.SECTION]["seen"] == kernel.state["version"]


# ----------------------------------------------------------------------------- the task term


def test_the_term_commitment_holds_for_the_person_the_item_and_the_state():
    game, log, _ = promised_in_the_evening()
    kernel = game._kernel
    env = agenda_terms.Env(kernel.world, kernel.state["world"], clock.at(kernel.state["tick"]))

    def holds(**fields):
        return agenda_terms.holds(
            env, {"kind": "commitment", "by": LI_DA, "item": "bamboo"} | fields
        )

    assert holds(state="promised") and not holds(state="delivered")
    assert not holds(state="promised", by="zhou_zhanggui") and not holds(
        state="promised", item="timber"
    )
    play_to(game, log, at(2, 8))
    assert holds(state="delivered") and not holds(state="promised")


# ------------------------------------------------------------------------------ later batches

LI_DA_MATERIAL = {"verb": "entrust", "npc": LI_DA, "kind": "material"}
PROMISED_LINE = {
    "zh": "李大已经答应了，明早07:00前送四根竹料",
    "en": "Li Da has promised already: 4 poles of bamboo, by 7 tomorrow morning",
}
ENOUGH_LINE = {
    "zh": "桥边的竹料已经够了",
    "en": "There is enough bamboo at the bridge already",
}


def look(game: Game, **action) -> dict:
    return json.loads(game.preview_json(json.dumps({**LI_DA_MATERIAL, **action})))


def said_by(out: dict, person: str = LI_DA) -> dict:
    (bubble,) = [b for b in out["frame"]["bubbles"] if b["npc"] == person]
    return bubble["text"]


def ways_to_say(game: Game, code: str, lead: str, person: str = LI_DA) -> list[dict]:
    """Every way ``person`` says the line ``code`` about the promise or the item ``lead`` now."""
    today = clock.at(game.tick).day
    return [
        commitments.say_goods(state_of(game), way, code, lead, today)
        for way in voices.variants(person, code)
    ]


def ask_at(game: Game, log: Log, trust_in_him: int) -> dict:
    """The manager asks Li Da for the bamboo with the gate open and that much trust in them."""
    meet(game, LI_DA)
    log.version = game._kernel.state["version"]
    me(game)["nod"]["bamboo"] = game.tick
    believe(game, LI_DA, clarify.CLAIM, 90, "saw")
    trust(game, LI_DA, trust_in_him)
    out = log.feed(act(game, "entrust", kind="material"))
    log.feed(act(game, "leave"))
    return out


def test_after_a_delivery_the_bamboo_is_asked_for_again_and_the_next_batch_is_promised():
    game, log, _ = promised_in_the_evening()
    play_to(game, log, at(2, 8))
    assert row_of(game)["state"] == "delivered" and frame_now(game)["site"]["bamboo"] == 4
    out = ask(game, log)  # the same request as the first, put once more
    assert acks(out) == [("applied", None)]
    (made,) = events(out, "commitment")
    assert (made["id"], made["state"], made["amount"]) == ("m2", "promised", 4)
    rows = [(c["id"], c["state"], c["amount"]) for c in frame_now(game)["commitments"]]
    assert rows == [("m1", "delivered", 4), ("m2", "promised", 4)]
    assert state_of(game)[commitments.SECTION]["list"][1]["due"] == {"day": 2, "hour": 11}
    play_to(game, log, at(2, 12))
    assert frame_now(game)["site"]["bamboo"] == 8
    out = ask(game, log)  # and the third is what the bridge still lacks, not another four
    assert acks(out) == [("applied", None)]
    rows = [(c["id"], c["state"], c["amount"]) for c in frame_now(game)["commitments"]]
    assert rows == [("m1", "delivered", 4), ("m2", "delivered", 4), ("m3", "promised", 2)]
    play_to(game, log, at(3, 8))
    assert frame_now(game)["site"]["bamboo"] == 10
    assert "bamboo_delivered" in state_of(game)["goals"]["flags"]


def test_after_a_break_the_request_is_weighed_again_and_the_batch_is_promised_again():
    game, log, _ = promised_in_the_evening(weather_clear=0, weather_light=0, weather_heavy=1)
    play_to(game, log, at(2, 10) + 1)
    assert row_of(game)["state"] == "broken"
    out = ask(game, log)
    assert acks(out) == [("applied", None)]
    states = [(c["id"], c["state"], c["amount"]) for c in frame_now(game)["commitments"]]
    assert states == [("m1", "broken", 4), ("m2", "promised", 4)]  # the bridge lacks all ten still


def test_after_a_promise_is_taken_back_the_request_is_weighed_again():
    game, log, _ = promised_in_the_evening()
    kernel = game._kernel
    assert commitments.withdraw(Sim(kernel.world, Ctx(kernel)), "m1") is True
    out = ask(game, log)
    assert acks(out) == [("applied", None)]
    states = [(c["id"], c["state"]) for c in frame_now(game)["commitments"]]
    assert states == [("m1", "withdrawn"), ("m2", "promised")]


def test_a_no_is_not_weighed_again_until_something_moves_and_a_delivery_is_something():
    game, log, _ = promised_in_the_evening()
    play_to(game, log, at(2, 8))
    out = ask_at(game, log, objection.TRUST_MIN)  # he trusts the manager just enough to be asked
    assert acks(out) == [("rejected", "refused")]
    assert [e["result"] for e in events(out, "entrusted")] == ["refused"]
    assert len(frame_now(game)["commitments"]) == 1
    out = ask_at(game, log, objection.TRUST_MIN)  # nothing moved: he has said so already
    assert acks(out) == [("rejected", "said_already")]
    assert said_by(out) in voices.variants(LI_DA, "said_already")  # the plain one: no promise open
    out = ask_at(game, log, 60)  # the score moved
    assert acks(out) == [("applied", None)]
    assert [c["state"] for c in frame_now(game)["commitments"]] == ["delivered", "promised"]


def test_the_situation_of_a_request_for_the_goods_carries_the_promises_made():
    game, log, _ = promised_in_the_evening()
    world = state_of(game)
    assert commitments.round_mark(world, LI_DA) == "p1:promised"
    assert commitments.round_mark(world, "zhou_zhanggui") == ""  # he has promised nothing
    assert commitments.round_mark(world, "li_laotai") == ""  # and she brings nothing
    play_to(game, log, at(2, 8))
    assert commitments.round_mark(state_of(game), LI_DA) == "p1:delivered"
    assert entrust.situation(state_of(game), LI_DA, "material", False) == "p1:delivered"
    assert entrust.situation(state_of(game), LI_DA, "lend", False) == ""  # only the goods count
    assert entrust.situation(state_of(game), LI_DA, "lane", True) == "closed"


def test_asking_while_a_promise_is_open_is_answered_with_a_line_that_names_it():
    game, log, _ = promised_in_the_evening()
    out = ask(game, log)
    assert acks(out) == [("rejected", "said_already")]
    assert not events(out, "commitment") and len(frame_now(game)["commitments"]) == 1
    said = said_by(out)
    assert said in ways_to_say(game, "promise_open", "m1")
    assert len(voices.variants(LI_DA, "promise_open")) >= 2
    # the amount, the item and the day and the hour are in it, in both languages
    assert "四根竹料" in said["zh"] and "明早七点前" in said["zh"]
    assert "4 poles of bamboo" in said["en"] and "by seven tomorrow morning" in said["en"]
    assert "{" not in said["zh"] + said["en"]
    assert said not in voices.variants(LI_DA, "said_already")  # not the bare "I have said so"


def test_the_preview_says_what_the_person_says_while_a_promise_is_open():
    game, log, _ = promised_in_the_evening()
    meet(game, LI_DA)
    before, snapshot = game.hash(), game.snapshot_json()
    got = look(game)
    assert game.hash() == before and game.snapshot_json() == snapshot  # it only read
    assert got["blockers"] == [PROMISED_LINE] and got["odds"] is None
    out = act(game, "entrust", kind="material")  # and the request is turned away for that
    assert acks(out) == [("rejected", "said_already")]
    assert said_by(out) in ways_to_say(game, "promise_open", "m1")


def test_when_the_bridge_has_all_the_bamboo_asking_says_so_and_the_preview_agrees():
    game, log, _ = promised_in_the_evening()
    play_to(game, log, at(2, 8))
    ask(game, log)
    play_to(game, log, at(2, 12))
    ask(game, log)
    play_to(game, log, at(2, 16))
    assert frame_now(game)["site"]["bamboo"] == 10
    meet(game, LI_DA)
    me(game)["nod"]["bamboo"] = game.tick
    got = look(game)
    assert got["blockers"] == [ENOUGH_LINE]
    out = act(game, "entrust", kind="material")
    assert acks(out) == [("rejected", "said_already")]
    said = said_by(out)
    assert said in ways_to_say(game, "goods_enough", "bamboo")
    assert "竹料" in said["zh"] and "bamboo" in said["en"] and "{" not in said["zh"] + said["en"]
    assert len(frame_now(game)["commitments"]) == 3  # no fourth promise


def test_the_same_holds_for_the_timber_when_the_script_gives_it_in_batches(script_rules):
    script_rules(batches={"bamboo": 4, "timber": 3})
    game, log = start()
    play_to(game, log, at(1, 18, 20))
    out = ask(game, log, "zhou_zhanggui", nod=False)
    assert acks(out) == [("applied", None)]
    assert [(c["item"], c["amount"]) for c in frame_now(game)["commitments"]] == [("timber", 3)]
    out = ask(game, log, "zhou_zhanggui", nod=False)  # his promise is open
    assert acks(out) == [("rejected", "said_already")]
    said = said_by(out, "zhou_zhanggui")
    assert said in ways_to_say(game, "promise_open", "m1", "zhou_zhanggui")
    assert "三根木料" in said["zh"] and "3 poles of timber" in said["en"]
    meet(game, "zhou_zhanggui")
    assert look(game, npc="zhou_zhanggui")["blockers"] == [
        {
            "zh": "周掌柜已经答应了，明早07:00前送三根木料",
            "en": "Shopkeeper Zhou has promised already: 3 poles of timber, by 7 tomorrow morning",
        }
    ]
    act(game, "leave")
    play_to(game, log, at(2, 8))
    for want in (3, 2):  # then three more, then what is lacking
        out = ask(game, log, "zhou_zhanggui", nod=False)
        assert acks(out) == [("applied", None)]
        assert frame_now(game)["commitments"][-1]["amount"] == want
        play_to(game, log, game.tick + 700)
    assert frame_now(game)["site"]["timber"] == 8
    out = ask(game, log, "zhou_zhanggui", nod=False)
    assert acks(out) == [("rejected", "said_already")]
    assert said_by(out, "zhou_zhanggui") in ways_to_say(
        game, "goods_enough", "timber", "zhou_zhanggui"
    )


def test_the_plain_words_of_the_goods_lines_fill_the_slots_too_for_the_prompt_of_a_model():
    """A model is told what the rules had the person say, in the plain words of the town and not
    in their voice (``converse.words`` with ``plain``): the numbers are in those as well."""
    game, log, _ = promised_in_the_evening()
    world = state_of(game)
    open_line = [LI_DA, game.tick + 600, "goods", "promise_open", "m1"]
    today = clock.at(game.tick).day
    assert converse.words(world, open_line, plain=True, today=today) == {
        "zh": "我答应过了，明早七点前把四根竹料送到桥边。",
        "en": "I've promised already: 4 poles of bamboo at the bridge by seven tomorrow morning.",
    }
    # where no day is named the time is the date of the game, as the cards write it
    assert converse.words(world, open_line, plain=True) == {
        "zh": "我答应过了，第二天07:00前把四根竹料送到桥边。",
        "en": "I've promised already: 4 poles of bamboo at the bridge by 07:00 on day 2.",
    }
    enough = [LI_DA, game.tick + 600, "goods", "goods_enough", "timber"]
    assert converse.words(world, enough, plain=True) == {
        "zh": "桥边的木料已经够了。",
        "en": "There is enough timber at the bridge already.",
    }
    voiced = converse.words(world, open_line, today=today)  # in his voice, the same numbers
    assert voiced in ways_to_say(game, "promise_open", "m1")
    assert voiced != converse.words(world, open_line, plain=True, today=today)


SPOKEN = [  # (today, day, hour) -> what a person says
    ((1, 1, 9), "今早九点前", "by nine this morning"),
    ((1, 1, 13), "今天下午一点前", "by one this afternoon"),
    ((1, 1, 17), "今天傍晚五点前", "by five this evening"),
    ((1, 1, 21), "今天晚上九点前", "by nine tonight"),
    ((1, 2, 7), "明早七点前", "by seven tomorrow morning"),
    ((1, 2, 10), "明天上午十点前", "by ten tomorrow morning"),
    ((1, 2, 12), "明天中午十二点前", "by noon tomorrow"),
    ((1, 2, 14), "明天下午两点前", "by two tomorrow afternoon"),
    ((1, 2, 18), "明天傍晚六点前", "by six tomorrow evening"),
    ((1, 2, 22), "明天晚上十点前", "by ten tomorrow night"),
    ((1, 3, 18), "后天傍晚前", "by the evening of the day after tomorrow"),
    ((1, 3, 7), "后天早上七点前", "by seven on the morning of the day after tomorrow"),
    ((1, 3, 12), "后天中午前", "by noon on the day after tomorrow"),
    ((2, 4, 18), "后天傍晚前", "by the evening of the day after tomorrow"),
    ((1, 4, 18), "第四天傍晚前", "by the evening of day 4"),
    ((1, 5, 7), "第五天早上七点前", "by seven on the morning of day 5"),
    ((3, 2, 7), "第二天07:00前", "by 07:00 on day 2"),  # a day gone by is dated, as on the cards
]


@pytest.mark.parametrize(("when", "zh", "en"), SPOKEN)
def test_a_person_says_when_a_promise_falls_due_by_the_day_it_is_said_on(when, zh, en):
    assert commitments.spoken_when(*when) == {"zh": zh, "en": en}


def test_the_spoken_time_has_no_digit_and_no_slot_for_any_hour_of_the_game_in_either_language():
    for today in (1, 2, 4):
        for day in range(today, today + 5):
            for hour in range(6, 24):
                said = commitments.spoken_when(today, day, hour)
                assert said["zh"].endswith("前") and said["en"].startswith("by ")
                assert "{" not in said["zh"] + said["en"]
                digits = any(ch.isdigit() for ch in said["zh"] + said["en"])
                assert not digits or "day " in said["en"], said
    # the cards keep the date of the game, which does not change as time goes by
    assert commitments.when_words(2, 7) == {"zh": "第二天07:00前", "en": "by 07:00 on day 2"}


def test_the_answer_to_a_request_that_is_turned_away_is_not_an_event_of_the_promises():
    game, log, _ = promised_in_the_evening()
    out = ask(game, log)
    assert [e["kind"] for e in out["events"] if e["kind"] in ("commitment", "agreed")] == []
    assert state_of(game)["player"]["asked"]  # the first yes was kept as the situation it was
    plain(state_of(game)[commitments.SECTION])


# ------------------------------------------------------------------------------ replay


def test_a_recording_of_the_promise_and_the_morning_is_replayed_to_the_same_game():
    game = slice_game(dev_actions=1)
    recorder = Recorder(game)
    recorder.step("[]")
    while game.tick < at(1, 18, 20):
        recorder.step()
    body = {"action_id": "a1", "type": "dev_goal", "op": "material", "npc": LI_DA}
    recorder.step(json.dumps([{"seq": game.next_seq, "kind": "player", "body": body}]))
    while game.tick < at(2, 8):
        recorder.step()
    recording = canon.loads(canon.dumps_str(recorder.recording()))
    again = rebuild(recording)  # it checks every hash on the way
    assert again.hash() == game.hash() and again.snapshot_json() == game.snapshot_json()
    assert (
        json.loads(again.snapshot_json())["world"]["commitments"]["list"][0]["state"] == "delivered"
    )
