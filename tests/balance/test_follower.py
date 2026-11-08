"""The follower does what the task card says, and writes down where the card leaves it stuck.

Two kinds of test. The first plays the follower on a stage: a frame set up by hand and a core that
acknowledges whatever the bot sends, so that any card (a request, a kind of speech, a window on a
later day) can be put in front of it and the action it sends read off. The second plays whole
games with the real core: the game the opening page starts, and the report that is made of such
games.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import pytest

import balance
import bots
import follow_report
from bots.base import Obs, since_dawn
from bots.follower import Follower
from lantern_core.api import Game, preset

SLICE = preset("slice")
SCENE = json.loads(Game(SLICE["seed"], SLICE["scenario"], SLICE["config"]).scene_json())
DAY = balance.TICKS_PER_DAY
SECOND_DAY_ENDS = 2 * DAY  # the tick at which the third day begins


# ---------------------------------------- a stage for one card


def words(text: str | None) -> dict[str, str] | None:
    return None if text is None else {"zh": text, "en": text}


def card(
    task_id: str,
    *,
    state: str = "open",
    action: dict[str, Any] | None = None,
    window: dict[str, Any] | None = None,
    blocker: str | None = None,
    nxt: str | None = None,
    expected: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    found = {
        "id": task_id,
        "kind": "need",
        "job": "bridge",
        "text": words(task_id),
        "why": words(f"why {task_id}"),
        "next": words(nxt),
        "state": state,
        "blocker": words(blocker),
        "action": action,
        "window": window,
    }
    if expected is not None:
        found["expected"] = expected
    return found


def offer(offer_id: str, body: dict[str, Any]) -> dict[str, Any]:
    return {"id": offer_id, "label": {"zh": offer_id, "en": offer_id}, "body": body}


Answer = Callable[[dict[str, Any]], tuple[str, str | None]]


class Stage:
    """One frame, kept by hand, and a core that says ``applied`` to everything unless told not to.

    The player stands where ``pos`` says, the people where ``npcs`` says, and a ``move`` puts them
    at the cell or the door it names. ``answers`` maps an action type to ``(result, reason)``, and
    ``on`` maps it to a function that may change the stage and gives the answer. The clock is
    ``minutes`` since 06:00 of the first day, and ``at`` sets it."""

    def __init__(self, **frame: Any) -> None:
        self.minutes = 2 * 60  # 08:00
        self.tick = 0
        self.pos = (7, 5)
        self.npcs: dict[str, tuple[int, int]] = {"li_laotai": (8, 5), "li_da": (8, 6)}
        self.talking: str | None = None
        self.tasks: list[dict[str, Any]] = []
        self.tracked: str | None = None
        self.offers: dict[str, list[dict[str, Any]]] = {}
        self.speak_offers: list[dict[str, Any]] = []
        self.topics: list[dict[str, Any]] = []
        self.notebook: list[dict[str, Any]] = []
        self.judgments: list[dict[str, Any]] = []
        self.hint: dict[str, Any] | None = None
        self.can_speak = False
        self.events: list[dict[str, Any]] = []
        self.sent: list[dict[str, Any]] = []
        self.answers: dict[str, tuple[str, str | None]] = {}
        self.on: dict[str, Answer] = {}
        self.__dict__.update(frame)

    def at(self, hour: int, minute: int = 0, day: int = 1) -> None:
        self.minutes = (day - 1) * 1440 + since_dawn(hour, minute)

    def clock(self) -> dict[str, Any]:
        day, rest = divmod(self.minutes, 1440)
        hour, minute = divmod((360 + rest) % 1440, 60)
        return {
            "day": day + 1,
            "hour": hour,
            "minute": minute,
            "phase": "day" if 6 <= hour < 21 else "night",
        }

    def verbs(self) -> list[str]:
        out = ["leave", "ask"] if self.talking else ["move", "talk"]
        if len(self.notebook) >= 2:
            out += ["judge", "hint"]
        if self.can_speak and not self.talking:
            out.append("speak")
        if len(self.tasks) > 1:
            out.append("track")
        return out

    def out(self) -> dict[str, Any]:
        talk = {"npc": self.talking, "costs": {}, "leaves_at": None} if self.talking else None
        offers = {"entrust": [], "promise": [], "tell": [], **(self.offers if talk else {})}
        player = {
            "x": self.pos[0],
            "y": self.pos[1],
            "activity": "chat" if talk else "rest",
            "talk": talk,
            "offers": {**offers, "speak": [] if talk else self.speak_offers},
            "topics": self.topics if talk else [],
            "look": [],
        }
        frame = {
            "npcs": [{"id": n, "x": x, "y": y} for n, (x, y) in self.npcs.items()],
            "time": self.clock(),
            "player": player,
            "hud": {"verbs": self.verbs(), "bridge": {"state": "broken", "percent": 0}},
            "notebook": self.notebook,
            "tasks": self.tasks,
            "tracked": self.tracked,
            "judgments": self.judgments,
            "hint": self.hint,
        }
        return {"tick": self.tick, "advanced": True, "frame": frame, "events": self.events}

    def apply(self, action: dict[str, Any]) -> None:
        """What the core does with one action: its acknowledgement, in the next events."""
        self.sent.append(action)
        kind = action["type"]
        result, reason = self.answers.get(kind, ("applied", None))
        if kind in self.on:
            result, reason = self.on[kind](action)
        if kind == "talk":
            self.talking = action["npc"]
        elif kind == "leave":
            self.talking = None
        elif kind == "track":
            self.tracked = action["task"]
        elif kind == "move":
            doors = {p["id"]: p["door"] for p in SCENE["places"] if p["door"]}
            self.pos = (
                tuple(doors[action["place"]]) if "place" in action else (action["x"], action["y"])
            )
        self.events = [
            {
                "kind": "action_ack",
                "tick": self.tick,
                "action_id": action["action_id"],
                "result": result,
                "reason": reason,
            }
        ]


def drive(stage: Stage, bot: Follower, calls: int = 40, minutes: int = 0) -> list[dict[str, Any]]:
    """Call the bot ``calls`` times, answering each action; ``minutes`` pass between two calls."""
    start = len(stage.sent)
    for _ in range(calls):
        action = bot.decide(Obs(stage.out()))
        stage.events = []
        if action is not None:
            stage.apply(action)
        stage.minutes += minutes
        stage.tick += 2 * minutes + 1
    return stage.sent[start:]


def kinds(sent: list[dict[str, Any]]) -> list[str]:
    return [a["type"] for a in sent]


def one_card(action: dict[str, Any], **stage: Any) -> tuple[Stage, Follower]:
    """A stage with one open card whose action is ``action``, and a follower to put before it."""
    played = Stage(tasks=[card("t_try", action=action)], tracked="t_try", **stage)
    return played, Follower(SCENE)


def alone(*tasks: dict[str, Any], **stage: Any) -> tuple[Stage, Follower]:
    played = Stage(tasks=list(tasks), tracked=tasks[0]["id"], **stage)
    return played, Follower(SCENE)


# ---------------------------------------- picking from the frame


def test_the_follower_is_a_bot_of_its_own():
    assert bots.BOTS["follower"] is Follower and Follower.name == "follower"


def test_a_card_that_names_an_item_gets_the_request_that_brings_it_or_lends_it():
    lend = [offer("lend", {"kind": "lend"}), offer("join", {"kind": "join"})]
    bring = [offer("material", {"kind": "material"})]
    for who, offers, kind in (("li_laotai", lend, "lend"), ("li_da", bring, "material")):
        played, bot = one_card({"verb": "entrust", "npc": who, "item": "bamboo"})
        played.offers = {"entrust": offers}
        sent = drive(played, bot)
        assert [a["kind"] for a in sent if a["type"] == "entrust"] == [kind]
        assert kinds(sent)[0] == "talk" and kinds(sent)[-1] == "leave"


def test_a_request_and_a_target_pick_the_offer_that_names_them():
    offers = [
        offer("join", {"kind": "join"}),
        offer("persuade:li_da", {"kind": "persuade", "target": "li_da"}),
        offer("persuade:li_er", {"kind": "persuade", "target": "li_er"}),
    ]
    action = {"verb": "entrust", "npc": "li_laotai", "request": "persuade", "target": "li_er"}
    played, bot = one_card(action)
    played.offers = {"entrust": offers}
    asked = [a for a in drive(played, bot) if a["type"] == "entrust"]
    assert [(a["kind"], a["target"]) for a in asked] == [("persuade", "li_er")]
    played, bot = one_card({"verb": "entrust", "npc": "li_laotai", "request": "join"})
    played.offers = {"entrust": offers}
    asked = [a for a in drive(played, bot) if a["type"] == "entrust"]
    assert [a["kind"] for a in asked] == ["join"]


def test_a_request_the_frame_does_not_offer_is_a_stall_and_nothing_is_asked():
    played, bot = one_card({"verb": "entrust", "npc": "li_laotai", "request": "convene"})
    played.offers = {"entrust": [offer("join", {"kind": "join"})]}
    assert "entrust" not in kinds(drive(played, bot))
    (stall,) = [s for s in bot.stalls if s["kind"] == "cannot_carry_out"]
    assert (stall["task"], stall["reason"]) == ("t_try", "no_offer")
    assert "join" in stall["detail"] and stall["frame"]["tasks"][0]["id"] == "t_try"


def test_the_topic_a_card_names_is_asked_and_without_one_the_first_not_asked_yet():
    topics = [{"id": "n1", "kind": "entry"}, {"id": "t_rail", "kind": "thing"}]
    played, bot = one_card({"verb": "ask", "npc": "li_laotai", "item": "t_rail"}, topics=topics)
    assert [a["topic"] for a in drive(played, bot) if a["type"] == "ask"] == ["t_rail"]
    played, bot = one_card({"verb": "ask", "npc": "li_laotai"}, topics=topics)
    assert [a["topic"] for a in drive(played, bot) if a["type"] == "ask"] == ["n1", "t_rail"]
    assert [n["what"] for n in bot.notes] == ["topic"]
    played, bot = one_card({"verb": "ask", "npc": "li_laotai", "item": "t_nothing"}, topics=topics)
    assert "ask" not in kinds(drive(played, bot))
    assert [s["reason"] for s in bot.stalls] == ["no_topic"]


def test_ask_source_goes_to_the_entry_whose_trail_leaves_that_person_to_ask():
    named = {"id": "li_laotai", "en": "Granny Li", "zh": "李老太"}
    entries = [
        {"id": "n1", "text": words("a"), "chain": [named, {"id": "cha_laoban"}, None]},
        {"id": "n2", "text": words("b"), "chain": [named, {"id": "li_laotai"}, None]},
    ]
    played, bot = one_card({"verb": "ask_source", "npc": "li_laotai"}, notebook=entries)
    asked = [a for a in drive(played, bot) if a["type"] == "ask_source"]
    assert [a["entry"] for a in asked] == ["n2"]
    played, bot = one_card({"verb": "ask_source", "npc": "li_da"}, notebook=entries)
    assert "ask_source" not in kinds(drive(played, bot))
    assert [s["reason"] for s in bot.stalls] == ["no_entry"]


def test_a_card_that_says_promise_takes_the_offer_it_names_or_the_first():
    offers = [
        offer("keep:k1", {"op": "keep", "id": "k1"}),
        offer("wage:10", {"op": "make", "what": "wage", "amount": 10}),
        offer("stall:front", {"op": "make", "what": "stall", "item": "front"}),
    ]
    played, bot = one_card({"verb": "promise", "npc": "li_laotai", "item": "stall"})
    played.offers = {"promise": offers}
    made = [a for a in drive(played, bot) if a["type"] == "promise"]
    assert [(a["what"], a["item"]) for a in made] == [("stall", "front")]
    played, bot = one_card({"verb": "promise", "npc": "li_laotai"})
    played.offers = {"promise": offers}
    made = [a for a in drive(played, bot) if a["type"] == "promise"]
    assert [a["what"] for a in made] == ["wage"] and [n["what"] for n in bot.notes] == ["promise"]


def test_a_card_that_says_to_keep_a_promise_takes_the_offer_to_keep_that_one():
    offers = [
        offer("keep:k1", {"op": "keep", "id": "k1"}),
        offer("keep:k2", {"op": "keep", "id": "k2"}),
        offer("stall:front", {"op": "make", "what": "stall", "item": "front"}),
    ]
    keep = {"verb": "promise", "npc": "li_laotai", "item": "k2", "kind": "keep"}
    played, bot = one_card(keep)
    played.offers = {"promise": offers}
    made = [a for a in drive(played, bot) if a["type"] == "promise"]
    assert [(a["op"], a["id"]) for a in made] == [("keep", "k2")]  # not the first, not a new one
    assert not bot.notes  # the card says which, so the bot did not have to pick
    # a promise the talk does not offer to keep is a stall and nothing is promised
    played, bot = one_card({**keep, "item": "k3"})
    played.offers = {"promise": offers}
    assert "promise" not in kinds(drive(played, bot))
    assert [(s["kind"], s["reason"]) for s in bot.stalls] == [("cannot_carry_out", "no_offer")]
    assert "k3" in bot.stalls[0]["detail"] and "keep:k1" in bot.stalls[0]["detail"]


# ---------------------------------------- speaking in public


def at_the_teahouse(action: dict[str, Any], **stage: Any) -> tuple[Stage, Follower]:
    played, bot = one_card(action, **stage)
    played.pos, played.can_speak = (34, 13), True
    played.at(17, 30)
    return played, bot


SPEECH = [offer("all", {"kind": "evidence"}), offer("meal", {"kind": "meal"})]
JUDGED = [{"a": "n2", "b": "n1", "relation": "unsupported", "made": 5}]
CLARIFY = {"kind": "clarify", "claim": "n1", "basis": ["n2"], "judgment": "unsupported"}


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("evidence", {"kind": "evidence"}),
        ("meal", {"kind": "meal"}),
        ("clarify", CLARIFY),
        (None, CLARIFY),
    ],
)
def test_a_speech_has_the_kind_the_card_names(kind, expected):
    action = {"verb": "speak", **({"kind": kind} if kind else {})}
    played, bot = at_the_teahouse(action, speak_offers=SPEECH, judgments=JUDGED)
    spoke = [a for a in drive(played, bot) if a["type"] == "speak"]
    assert [{k: v for k, v in a.items() if k not in ("type", "action_id")} for a in spoke] == [
        expected
    ]


def test_a_speech_with_nothing_to_say_is_a_stall():
    played, bot = at_the_teahouse({"verb": "speak", "kind": "clarify"}, speak_offers=SPEECH)
    assert "speak" not in kinds(drive(played, bot))
    assert [s["reason"] for s in bot.stalls] == ["no_pair"]
    played, bot = at_the_teahouse({"verb": "speak", "kind": "evidence"}, speak_offers=SPEECH[1:])
    assert "speak" not in kinds(drive(played, bot))
    assert [s["reason"] for s in bot.stalls] == ["no_offer"]


def test_a_card_that_says_speak_waits_for_the_hour_the_core_allows_it():
    played, bot = at_the_teahouse({"verb": "speak", "kind": "meal"}, speak_offers=SPEECH)
    played.can_speak = False
    played.at(14)
    assert "speak" not in kinds(drive(played, bot, calls=30, minutes=2))
    played.can_speak = True
    assert [a["kind"] for a in drive(played, bot) if a["type"] == "speak"] == ["meal"]


# ---------------------------------------- the hint button


def entries_of(*ids: str) -> list[dict[str, Any]]:
    return [{"id": i, "text": words(i), "chain": [None]} for i in ids]


def test_a_card_with_no_action_and_no_time_gets_the_hint_button_and_the_pair_is_judged():
    played, bot = alone(card("t_think"), notebook=entries_of("n1", "n2"))

    def hint(action: dict[str, Any]) -> tuple[str, str | None]:
        if played.judgments:  # the one pair there is has been judged
            played.hint = None
        elif played.hint is None:
            played.hint = {"a": "n2", "b": "n1"}
        else:
            played.hint = {**played.hint, "relation": "unsupported"}
        return "applied", None

    def judge(action: dict[str, Any]) -> tuple[str, str | None]:
        played.judgments = [{"a": action["a"], "b": action["b"], "relation": action["relation"]}]
        played.hint = None
        return "applied", None

    played.on = {"hint": hint, "judge": judge}
    sent = drive(played, bot)
    assert kinds(sent)[:3] == ["hint", "hint", "judge"]
    assert (sent[2]["a"], sent[2]["b"], sent[2]["relation"]) == ("n2", "n1", "unsupported")
    assert bot.pairs_judged == 1 and [n["what"] for n in bot.notes] == ["notebook"]


def test_when_the_hint_names_no_pair_it_is_not_pressed_again_until_the_notebook_moves():
    played, bot = alone(card("t_think"), notebook=entries_of("n1", "n2"))
    assert kinds(drive(played, bot, calls=60, minutes=3)) == ["hint"]
    played.notebook = entries_of("n1", "n2", "n3")
    assert kinds(drive(played, bot, calls=10)) == ["hint"]


# ---------------------------------------- the clock


def test_a_person_who_is_about_from_a_later_hour_is_waited_for_not_walked_to():
    window = {"day": 1, "from": 9, "to": 11, "place": "p_li_house"}
    played, bot = alone(card("t_wait", action={"verb": "talk", "npc": "li_laotai"}, window=window))
    played.at(7)
    assert drive(played, bot, calls=100, minutes=1) == []  # up to 08:40
    assert bot.stalls == []
    played.at(9)
    assert "talk" in kinds(drive(played, bot, calls=5))


def test_a_card_with_a_window_and_no_action_is_stood_at_when_the_window_opens():
    window = {"day": 1, "from": 9, "to": 11, "place": "p_bridge"}
    played, bot = alone(card("t_arrive", window=window))
    played.at(7)
    assert drive(played, bot, calls=30, minutes=2) == []
    played.at(9)
    (walk,) = [a for a in drive(played, bot, calls=10) if a["type"] == "move"]
    assert walk["place"] == "p_bridge"
    assert drive(played, bot, calls=200, minutes=1) == [] and bot.stalls == []


def test_two_hours_of_daylight_with_no_live_task_while_a_job_is_open_is_a_stall():
    played, bot = alone(card("t_done", state="done"))
    played.tracked = None
    drive(played, bot, calls=119, minutes=1)
    assert bot.stalls == []
    drive(played, bot, calls=3, minutes=1)
    (stall,) = bot.stalls
    assert stall["kind"] == "no_live_task"
    assert stall["frame"]["jobs_open"] == ["bridge", "truth", "peace"]
    assert stall["frame"]["clock"] == "d1 10:00"


def test_no_live_task_is_no_stall_once_the_three_jobs_are_done():
    played, bot = alone(card("t_done", state="done"))
    for flag in ("bridge_fixed", "truth_told", "reconciled"):
        played.events = [{"kind": "flag", "tick": 0, "flag": flag}]
        bot.decide(Obs(played.out()))
    drive(played, bot, calls=200, minutes=1)
    assert bot.stalls == []


def test_the_night_does_not_count_as_hours_without_a_live_task():
    played, bot = alone(card("t_done", state="done"))
    played.at(20)
    drive(played, bot, calls=60, minutes=1)  # 20:00 to 21:00
    drive(played, bot, calls=600, minutes=1)  # the night, to 07:00
    assert bot.stalls == []
    drive(played, bot, calls=61, minutes=1)  # an hour of daylight more makes two
    assert [s["kind"] for s in bot.stalls] == ["no_live_task"]


def test_a_task_blocked_for_four_hours_of_daylight_is_a_stall():
    played, bot = alone(card("t_stuck", state="blocked", blocker="Nobody will say", nxt="Wait"))
    drive(played, bot, calls=239, minutes=1)
    assert not [s for s in bot.stalls if s["kind"] == "blocked_long"]
    drive(played, bot, calls=3, minutes=1)
    (stall,) = [s for s in bot.stalls if s["kind"] == "blocked_long"]
    assert stall["task"] == "t_stuck" and "Nobody will say" in stall["detail"]
    assert "since d1 08:00" in stall["detail"]


def test_live_tasks_that_say_nothing_to_do_or_wait_for_are_a_stall_after_two_hours():
    played, bot = alone(card("t_vague"))
    drive(played, bot, calls=125, minutes=1)
    (stall,) = [s for s in bot.stalls if s["kind"] == "no_next_step"]
    assert "t_vague" in stall["detail"]


# ---------------------------------------- the card that is followed


def test_in_the_default_mode_the_follower_works_on_the_card_the_game_follows_and_never_tracks():
    two = [
        card("t_a", action={"verb": "talk", "npc": "li_laotai"}),
        card("t_b", action={"verb": "talk", "npc": "li_da"}),
    ]
    played, bot = Stage(tasks=two, tracked="t_b"), Follower(SCENE)
    sent = drive(played, bot, calls=60, minutes=1)
    assert "track" not in kinds(sent)
    assert {a["npc"] for a in sent if a["type"] == "talk"} == {"li_da"}
    # the card did not change, so it is left alone for a while and the other card is not touched
    assert [s["task"] for s in bot.stalls] == ["t_b"]
    assert bot.mode == "tracked"


def test_in_the_mode_list_the_follower_picks_its_own_card_and_follows_it_with_track():
    two = [
        card("t_a", action={"verb": "talk", "npc": "li_laotai"}),
        card("t_b", action={"verb": "talk", "npc": "li_da"}),
    ]
    played, bot = Stage(tasks=two, tracked="t_b"), Follower(SCENE, mode="list")
    sent = drive(played, bot, calls=60, minutes=1)
    asked = [
        (a["type"], a.get("npc") or a.get("task")) for a in sent if a["type"] in ("talk", "track")
    ]
    assert asked == [("talk", "li_da"), ("track", "t_a"), ("talk", "li_laotai")]
    assert played.tracked == "t_a"


def test_a_follower_of_a_mode_that_does_not_exist_is_refused():
    with pytest.raises(ValueError, match="unknown mode"):
        Follower(SCENE, mode="wander")


def test_a_blocked_task_that_is_not_followed_is_no_stall_in_the_default_mode():
    far = {"day": 1, "from": 20, "to": 21, "place": "p_bridge"}
    cards = [
        card("t_wait", window=far, nxt="At the bridge in the evening"),
        card("t_stuck", state="blocked", blocker="Nobody will say", nxt="Wait"),
    ]
    played, bot = Stage(tasks=cards, tracked="t_wait"), Follower(SCENE)
    drive(played, bot, calls=300, minutes=1)
    assert [s["kind"] for s in bot.stalls] == []
    played, bot = Stage(tasks=cards, tracked="t_wait"), Follower(SCENE, mode="list")
    drive(played, bot, calls=300, minutes=1)
    assert [s["kind"] for s in bot.stalls if s["kind"] == "blocked_long"] == ["blocked_long"]


def test_the_person_a_card_of_an_occasion_asks_is_asked_now_and_not_at_the_hour_of_the_occasion():
    """The elder is asked in the morning to call the clan; the window of the card is the evening at
    the teahouse. A card that lists who is expected there is about the occasion, and the person its
    button names is not the one who is found at that hour."""
    window = {"day": 1, "from": 17, "to": 19, "place": "p_teahouse"}
    action = {"verb": "entrust", "npc": "li_laotai", "request": "convene"}
    expected = [{"id": "li_laotai", "from": 1050, "to": 1140}]
    played, bot = alone(card("t_tell", action=action, window=window, expected=expected))
    played.offers = {"entrust": [offer("convene", {"kind": "convene"})]}
    sent = drive(played, bot)
    assert [a["kind"] for a in sent if a["type"] == "entrust"] == ["convene"]
    # a card without that list puts the person at the window, and the bot waits for it
    played, bot = alone(card("t_find", action=action, window=window))
    played.offers = {"entrust": [offer("convene", {"kind": "convene"})]}
    assert drive(played, bot, calls=30, minutes=1) == []


def test_a_card_that_says_to_judge_gets_the_hint_button_and_the_pair_is_judged():
    played, bot = alone(card("t_think", action={"verb": "judge"}), notebook=entries_of("n1", "n2"))

    def hint(action: dict[str, Any]) -> tuple[str, str | None]:
        if played.judgments:
            played.hint = None
        elif played.hint is None:
            played.hint = {"a": "n2", "b": "n1"}
        else:
            played.hint = {**played.hint, "relation": "unsupported"}
        return "applied", None

    def judge(action: dict[str, Any]) -> tuple[str, str | None]:
        played.judgments = [{"a": action["a"], "b": action["b"], "relation": action["relation"]}]
        played.hint = None
        return "applied", None

    played.on = {"hint": hint, "judge": judge}
    sent = drive(played, bot)
    assert kinds(sent)[:3] == ["hint", "hint", "judge"]
    assert bot.pairs_judged == 1


def test_a_card_that_says_to_tell_a_note_tells_the_entry_it_names():
    entries = [
        {"id": "n1", "text": words("a"), "chain": [None]},
        {"id": "n3", "text": words("b"), "chain": [None]},
    ]
    played, bot = one_card({"verb": "tell", "npc": "li_da", "item": "n3"}, notebook=entries)
    told = [a for a in drive(played, bot) if a["type"] == "tell"]
    assert [(a["entry"], a["how"]) for a in told] == [("n3", "faithful")]
    assert bot.notes == []  # the card named the entry: nothing was guessed


def test_a_look_that_names_a_place_is_walked_to_and_then_made():
    played, bot = one_card({"verb": "look", "item": "t_rail", "place": "p_bridge"})
    sent = drive(played, bot)
    assert kinds(sent)[:1] == ["move"] and sent[0]["place"] == "p_bridge"
    assert [a["at"] for a in sent if a["type"] == "look"] == ["t_rail"]


# ---------------------------------------- cards of a shape the bot does not know


def test_a_card_that_names_a_place_that_is_no_place_is_a_stall_and_not_a_crash():
    played, bot = one_card({"verb": "move", "place": "p_nowhere"})
    assert drive(played, bot) == []
    assert [(s["kind"], s["reason"]) for s in bot.stalls] == [("cannot_carry_out", "unknown_place")]


def test_a_card_with_an_unknown_verb_is_a_stall_and_the_bot_that_picks_goes_on_to_the_next_card():
    stuck = card("t_odd", action={"verb": "dance"})
    played, bot = alone(stuck, card("t_next", action={"verb": "talk", "npc": "li_laotai"}))
    assert (
        kinds(drive(played, bot)) == []
    )  # it follows the card the game follows, and that is stuck
    assert [s["reason"] for s in bot.stalls if s["task"] == "t_odd"] == ["unknown_verb"]
    played, bot = alone(stuck, card("t_next", action={"verb": "talk", "npc": "li_laotai"}))
    bot.mode = "list"
    assert "talk" in kinds(drive(played, bot))
    assert [s["reason"] for s in bot.stalls if s["task"] == "t_odd"] == ["unknown_verb"]


def test_an_offer_of_a_shape_the_bot_does_not_know_is_written_down_and_the_bot_leaves():
    played, bot = one_card({"verb": "entrust", "npc": "li_laotai", "request": "join"})
    played.offers = {"entrust": [{"id": "join"}]}  # no body
    sent = drive(played, bot)
    assert kinds(sent) == ["talk", "leave"]
    (stall,) = [s for s in bot.stalls if s["reason"] == "bot_error"]
    assert stall["kind"] == "cannot_carry_out" and "KeyError" in stall["detail"]


# ---------------------------------------- being turned down


def test_a_refusal_is_kept_with_the_cores_reason_and_the_card_is_let_alone_for_a_while():
    action = {"verb": "entrust", "npc": "li_da", "item": "bamboo"}
    played, bot = one_card(action)
    played.offers = {"entrust": [offer("material", {"kind": "material"})]}
    played.answers["entrust"] = ("rejected", "said_already")
    assert kinds(drive(played, bot, calls=60, minutes=1)).count("entrust") == 1  # to 09:00
    (stall,) = [s for s in bot.stalls if s["kind"] == "rejected"]
    assert stall["reason"] == "entrust:said_already" and stall["explained"] is False
    assert stall["frame"]["tasks"][0]["action"] == action
    assert kinds(drive(played, bot, calls=50, minutes=1)).count("entrust") == 0  # to 09:50
    assert kinds(drive(played, bot, calls=30, minutes=1)).count("entrust") == 1  # after two hours
    assert [s["count"] for s in bot.stalls if s["kind"] == "rejected"] == [2]


def test_a_refusal_after_which_the_card_says_why_is_marked_as_explained():
    action = {"verb": "entrust", "npc": "li_laotai", "item": "bamboo"}
    played, bot = one_card(action)
    played.offers = {"entrust": [offer("lend", {"kind": "lend"})]}

    def hard(_: dict[str, Any]) -> tuple[str, str | None]:
        blocked = card("t_try", state="blocked", blocker="Granny Li will not", action=action)
        played.tasks = [blocked]
        return "rejected", "hard"

    played.on["entrust"] = hard
    drive(played, bot, calls=10)
    (stall,) = [s for s in bot.stalls if s["kind"] == "rejected"]
    assert stall["reason"] == "entrust:hard" and stall["explained"] is True


def test_a_card_that_does_not_change_after_the_work_is_a_stall_and_one_that_does_is_not():
    action = {"verb": "talk", "npc": "li_laotai"}
    played, bot = one_card(action)
    drive(played, bot, calls=10)
    assert [s["kind"] for s in bot.stalls] == ["no_effect"]
    played, bot = one_card(action)

    def done(_: dict[str, Any]) -> tuple[str, str | None]:
        played.tasks = [card("t_try", state="done")]
        return "applied", None

    played.on["talk"] = done
    drive(played, bot, calls=10)
    assert bot.stalls == []


def test_a_person_who_is_not_where_the_card_puts_them_is_a_stall():
    window = {"day": 1, "from": 8, "to": 12, "place": "p_li_house"}
    played, bot = alone(card("t_find", action={"verb": "talk", "npc": "li_laotai"}, window=window))
    played.at(10)
    played.npcs["li_laotai"] = (40, 25)
    drive(played, bot, calls=3)
    (stall,) = [s for s in bot.stalls if s["reason"] == "not_at_window"]
    assert "li_laotai" in stall["detail"] and "p_li_house" in stall["detail"]


# ---------------------------------------- the game of the page


def play_the_page_game() -> tuple[dict[str, Any], Follower, list[Any]]:
    log: list[Any] = []
    row, _ = balance.play_game(
        SLICE["seed"], "follower", config=SLICE["config"], sample_every=10**9, log=log
    )
    return row, log.pop()[1], log


HOUR = balance.DAY_TICKS // 15  # ticks in an hour of daylight


def at_hour(day: int, hour: int) -> int:
    """The tick at which the clock reads ``hour`` o'clock of ``day`` (06:00 starts the game)."""
    return (day - 1) * DAY + (hour - 6) * HOUR


def flag_by(flag: str, day: int, hour: int) -> Callable[[Follower, dict[str, Any]], bool]:
    """A check that the festival raised this flag, and not later than the hour."""
    return lambda bot, row: bot.flags.get(flag, 10**9) <= at_hour(day, hour)


def first_bamboo_by(day: int, hour: int) -> Callable[[Follower, dict[str, Any]], bool]:
    def check(bot: Follower, row: dict[str, Any]) -> bool:
        first = next((d for d in bot.deliveries if d["item"] == "bamboo"), None)
        return first is not None and first["tick"] <= at_hour(day, hour)

    return check


# What the follower must have reached by the end of each later day, as ``(day, what, check)``, on
# the game the opening page starts: it follows the top bar and nothing else, and the opening game
# ends full (the bridge mended, the truth told, the families at peace). Each hour is the hour it
# reached it (the first bamboo 06:30 of the second day, the ten poles by half past eight, the bridge
# mended on the fourth morning at about half past nine: five helpers do five of the ten hours on
# each of the third and the fourth; the truth and the peace on the evening of the fourth day, at the
# hall a little after five, since no story can be told apart before the night watchman speaks, from
# three in the afternoon of the fourth day, and the elder has to be asked to call the clan after
# that) with a margin of a few hours. The check takes the follower and the row of the finished game.
def crew_by(day: int) -> Callable[[Follower, dict[str, Any]], bool]:
    """A check that the crew (five helpers, both families) was ready by the end of this day."""
    return lambda bot, row: row["crew_day"] != "" and int(row["crew_day"]) <= day


def every_promise_kept(bot: Follower, row: dict[str, Any]) -> bool:
    """The follower promised people things, and the cards had it keep every one by its day."""
    return int(row["promises"]) > 0 and row["promises_broken"] == 0


LATER_DAYS: list[tuple[int, str, Callable[[Follower, dict[str, Any]], bool]]] = [
    (2, "the first bamboo is at the bridge in the morning", first_bamboo_by(2, 9)),
    (2, "the bridge has all its bamboo before noon", flag_by("bamboo_delivered", 2, 12)),
    (3, "the crew of five is ready and has done its first morning", crew_by(3)),
    (4, "the bridge is mended by the end of the fourth morning", flag_by("bridge_fixed", 4, 12)),
    (4, "the truth is told in public on the fourth evening", flag_by("truth_told", 4, 21)),
    (4, "the two families are at peace on the fourth evening", flag_by("reconciled", 4, 21)),
    (4, "every promise made was kept on the cards", every_promise_kept),
    (5, "the night ends full", lambda bot, row: row["ending"] == "ending_full"),
]


def test_the_follower_plays_the_game_of_the_opening_page_to_the_end_and_gets_the_first_bamboo():
    row, bot, log = play_the_page_game()
    # to the end of the fifth day, with an ending
    assert int(row["ticks"]) >= 4 * DAY + balance.DAY_TICKS and row["bot"] == "follower"
    assert any(e["kind"] == "ending" for _, e in log)
    assert bot.timeline[0]["kind"] == "appeared"
    assert {"t_bamboo_first", "t_who_said", "t_what_proves", "t_clear_rumour"} <= set(bot.tasks)
    assert "t_see_for_yourself" not in bot.tasks  # that is for a game with no opening
    assert not [s for s in bot.stalls if s["reason"] == "bot_error"]
    # the same game and the same timeline every time
    again_row, again, _ = play_the_page_game()
    assert again_row["hash"] == row["hash"]
    assert again.timeline == bot.timeline and again.stalls == bot.stalls
    assert again.notes == bot.notes and again.flags == bot.flags
    # the first bamboo is at the bridge on the second day, with the bot there (the card sends the
    # bot to the bridge when the promise falls due, and it asks Li Da on the first evening)
    first = next(d for d in bot.deliveries if d["item"] == "bamboo")
    assert first["place"] == "p_bridge" and first["stood_there"] is True
    assert DAY <= first["tick"] <= SECOND_DAY_ENDS
    assert bot.tasks["t_bamboo_first"]["state"] == "done"
    assert bot.tasks["t_bamboo_first"]["ended"] <= SECOND_DAY_ENDS
    # the first speech, at the teahouse in the evening, is made of the two lines that the hint named
    # and the bot judged first
    steps = [(e["clock"], e["detail"]) for e in bot.timeline if e["kind"] == "did"]
    judged = [s for s in steps if s[1].startswith("judge ")]
    spoke = [s for s in steps if s[1].startswith("speak ")]
    assert judged[0][0].startswith("d1 07:") and "relation=unsupported" in judged[0][1]
    assert "kind=clarify" in spoke[0][1] and "judgment=unsupported" in spoke[0][1]
    assert spoke[0][0].startswith("d1 18:0")  # in the evening, at the teahouse, after six
    # the marks of the later days
    for day, what, check in LATER_DAYS:
        assert check(bot, row), f"day {day}: {what}"


def a_wait_that_is_no_fault_of_the_cards(stall: dict[str, Any]) -> bool:
    """A stall that is the game's own and not the card's: the person a card names is away on an
    errand (Li Da carrying the second batch of bamboo, or a helper at the bridge in the morning of
    work when the bot comes to keep a promise to them at the hour their routine has them at home),
    or the lead on how the bridge broke waits for the hour of the person it names. A head asked to
    keep a promise on the day it falls due can be at work at the bridge (a refusal of the place)."""
    waits = {("cannot_carry_out", "t_bamboo_rest"), ("no_effect", "t_how_broke")}
    keep = stall["task"].startswith("t_keep_")
    errand = stall["kind"] == "cannot_carry_out" and keep
    at_work = keep and stall["reason"] == "not_at_window"
    return (stall["kind"], stall["task"]) in waits or errand or at_work


def test_the_follower_gets_the_other_seeds_of_the_slice_config_through_to_a_full_night():
    games = follow_report.plan_games([1, 2, 3, 4], [])
    results = follow_report.play_all(games, jobs=2)
    for result in results:
        assert "error" not in result, result["label"]
        assert result["ending"] == "ending_full" and result["passage"] == "mended", result["label"]
        # every refusal the bot met is one the card explains, or one that passes
        unexplained = [
            s
            for s in result["stalls"]
            if s["kind"] == "rejected" and not (s["explained"] or s.get("transient"))
        ]
        assert not unexplained, (result["label"], [s["reason"] for s in unexplained])
        # and nothing but a refusal, but that the person the card names is away on an errand (Li Da
        # carrying the second batch of bamboo when the bot comes to ask), and that the lead on how
        # the bridge broke says to wait for the hour of the person it names (the night watchman,
        # after dark on the fourth day) and has no button yet: the bot presses the hint button,
        # which changes nothing
        other = [s for s in result["stalls"] if s["kind"] != "rejected"]
        assert all(a_wait_that_is_no_fault_of_the_cards(s) for s in other), (result["label"], other)
        assert all(s["reason"] in ("not_at_window", "unchanged") for s in other), other
        # it promised people things, as the cards sent it to, and kept every one by its day
        promises = result["row"]["promises"], result["row"]["promises_broken"]
        assert promises[0] > 0 and promises[1] == 0, result["label"]


def test_the_follower_keeps_every_promise_it_makes_though_it_makes_more_than_eight_in_a_game():
    """On this seed the cards send the follower to promise ten things before the people say yes,
    more than the cards of the first eight promises (there were eight cards once). A promise has a
    task whatever its number."""
    row, _ = balance.play_game(
        13, "follower", config=SLICE["config"], sample_every=10**9, bot_options={"mode": "tracked"}
    )
    assert int(row["promises"]) > 8 and int(row["promises_kept"]) == int(row["promises"])
    assert row["promises_broken"] == 0 and row["ending"] == "ending_full"


def test_the_follower_gets_the_other_stories_of_the_slice_through_to_a_full_night():
    """The rules of the opening page's game with the flood, the elder brother and, at other seeds,
    the boatman true: the same first day, and every one ends full with the bridge mended."""
    variants = [("v_flood", [1, 2]), ("v_drunk", [1, 2]), ("v_boat", [5, 6])]
    games = follow_report.plan_games([], [], variants=variants)
    assert [g["label"] for g in games] == [
        "slice-v_flood-1",
        "slice-v_flood-2",
        "slice-v_drunk-1",
        "slice-v_drunk-2",
        "slice-v_boat-5",
        "slice-v_boat-6",
    ]
    results = follow_report.play_all(games, jobs=2)
    for result in results:
        assert "error" not in result, result["label"]
        assert result["ending"] == "ending_full" and result["passage"] == "mended", result["label"]
        unexplained = [
            s
            for s in result["stalls"]
            if s["kind"] == "rejected" and not (s["explained"] or s.get("transient"))
        ]
        assert not unexplained, (result["label"], [s["reason"] for s in unexplained])
        # and nothing but a refusal, but the person away on an errand and the lead that waits for
        # the hour of the person it names (as in the test of the other seeds)
        other = [s for s in result["stalls"] if s["kind"] != "rejected"]
        assert all(a_wait_that_is_no_fault_of_the_cards(s) for s in other), (result["label"], other)
        assert "t_see_for_yourself" not in result["tasks"], result["label"]  # there is the opening
        assert result["flags"]["truth_told"] <= at_hour(4, 21), result["label"]
        assert result["flags"]["reconciled"] <= at_hour(4, 21), result["label"]


def test_the_follower_gets_the_first_bamboo_in_a_game_with_no_opening():
    """The default config has no talk of Li Er to follow. Granny Li turns the manager down, and the
    card of the first days takes the top bar until she no longer objects: it sends the manager to
    look about, to the clerk who was at the bridge that night (the third part of the statement card
    is then something to choose in), and to the night watchman in the afternoon of the fourth day.
    The statement of the fourth evening, made at the hall once the elder has called the clan, clears
    the talk in public, and the bamboo comes that evening or the next morning. The bridge is mended
    where the rain left the two mornings of work, else the lane behind the temple is the passage;
    the truth and the peace are done on the fourth evening in every game."""
    games = follow_report.plan_games([], [1, 2, 3, 4])
    results = follow_report.play_all(games, jobs=2)
    for result in results:
        assert "error" not in result, result["label"]
        assert result["ending"] in ("ending_full", "ending_barely"), result["label"]
        assert result["passage"] in ("mended", "detour"), result["label"]
        first = next(d for d in result["deliveries"] if d["item"] == "bamboo")
        assert first["tick"] <= at_hour(5, 8), result["label"]
        card = result["tasks"]["t_see_for_yourself"]
        assert card["state"] == "done" and card["ended"] <= first["tick"], result["label"]
        assert result["flags"]["truth_told"] <= at_hour(4, 21), result["label"]
        assert result["flags"]["reconciled"] <= at_hour(4, 21), result["label"]
        # the card is never blocked, and there is always a card to follow: nothing says that the bot
        # waited with nothing to do, or that the card of the bamboo (which asks a question that gets
        # no answer here) held the top bar. The one wait there is, on the card of the lane behind
        # the temple, is for the hours the helpers hang the lamps in.
        assert not [s for s in result["stalls"] if s["kind"] in ("blocked_long", "no_live_task")], (
            result["label"]
        )
        waits = [s for s in result["stalls"] if s["kind"] == "no_next_step"]
        assert all("t_detour" in s["detail"] for s in waits), result["label"]
        asks = [
            e
            for e in result["timeline"]
            if e["kind"] == "did" and e["task"] == "t_bamboo_first" and e["verb"] == "ask"
        ]
        assert not asks, result["label"]
        # it asked the clerk on the first day, as the card of the first days says
        clerk = [
            e
            for e in result["timeline"]
            if e["kind"] == "did" and e["task"] == "t_see_for_yourself" and e["verb"] == "ask"
        ]
        assert clerk and clerk[0]["clock"].startswith("d1 "), result["label"]


def test_the_report_plays_the_stories_it_is_asked_for_and_says_which_is_true(tmp_path, capsys):
    code = follow_report.main(
        ["--out", str(tmp_path), "--slice", "", "--default", "", "--variant", "v_flood=1"]
        + ["--variant", "v_drunk=2", "--days", "1", "--jobs", "1"]
    )
    assert code == 0
    text = (tmp_path / "follow_report.md").read_text(encoding="utf-8")
    assert "## 1. slice-v_flood-1 (slice rules, v_flood true, seed 1)" in text
    assert "## 2. slice-v_drunk-2 (slice rules, v_drunk true, seed 2)" in text
    data = json.loads((tmp_path / "follow_games.json").read_text(encoding="utf-8"))
    assert [(g["label"], g["seed"], g["variant"]) for g in data] == [
        ("slice-v_flood-1", 1, "v_flood"),
        ("slice-v_drunk-2", 2, "v_drunk"),
    ]
    assert "slice-v_flood-1" in capsys.readouterr().out
    for bad in ("v_nothing=1", "v_flood", "v_flood="):
        with pytest.raises(SystemExit):
            follow_report.main(["--out", str(tmp_path), "--variant", bad])


def test_the_follower_plays_the_default_game_for_two_days_without_trouble():
    log: list[Any] = []
    row, _ = balance.play_game(5, "follower", stop_tick=2 * DAY, log=log)
    bot = log.pop()[1]
    assert int(row["ticks"]) == 2 * DAY and bot.sent == int(row["actions"])
    assert bot.timeline[0]["task"] == "t_bamboo_first"


# ---------------------------------------- the report


def test_the_report_is_made_of_games_and_says_the_same_in_another_process():
    (game,) = follow_report.plan_games([492], [])
    game["days"] = 2
    (here,) = [follow_report.play(game)]
    (there,) = follow_report.play_all([game], jobs=2)
    here.pop("seconds"), there.pop("seconds")
    assert here == there


def test_the_report_has_a_line_for_every_game_and_the_stalls_of_each(tmp_path, capsys):
    code = follow_report.main(
        ["--out", str(tmp_path), "--slice", "492", "--default", "3", "--days", "1", "--jobs", "1"]
    )
    assert code == 0
    text = (tmp_path / "follow_report.md").read_text(encoding="utf-8")
    assert "## 1. slice-492 (the opening page's game)" in text
    assert "## 2. default-3 (default config)" in text
    for heading in ("### Timeline of the tasks", "### Stalls"):
        assert text.count(heading) == 2
    data = json.loads((tmp_path / "follow_games.json").read_text(encoding="utf-8"))
    assert [g["label"] for g in data] == ["slice-492", "default-3"]
    assert all(g["timeline"] and "stalls" in g for g in data)
    assert "slice-492" in capsys.readouterr().out


def test_a_game_that_raises_is_in_the_report_with_its_traceback_and_the_others_are_not_lost(
    tmp_path, capsys
):
    games = follow_report.plan_games([492], [])
    games.append({"label": "default-0", "seed": 0, "config": None, "kind": "default", "days": 0})
    games[0]["days"] = 1
    results = [follow_report.play(game) for game in games]
    assert "error" not in results[0] and "ValueError" in results[1]["error"]
    text = follow_report.render(results)
    assert "## 2. default-0 (default config)" in text and "The game raised an exception" in text
    assert follow_report.summary(results[1]).startswith("default-0")
    assert "CRASHED" in follow_report.summary(results[1])
