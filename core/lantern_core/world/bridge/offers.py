"""What the town puts forward for each verb that takes a choice: the offers of the frame.

The frame's ``player`` has ``offers``, ``{verb: [offer]}`` for the verbs ``tell``, ``entrust``,
``promise`` and ``speak``, and an offer is ``{"id": str, "label": {"zh", "en"}, "body": {...}}``:
the label to show and the fields of the action to send when it is chosen (the page adds ``type``
and ``action_id``). A verb has offers only where it can be used: the first three in a
conversation, the last where the manager may speak in public. Nothing here depends on which
variant of the story is true.

``tell``     for each entry of the notebook (the last ``MAX_ENTRIES``), the two ways a player has:
             as it is (``faithful``) and, for an entry that was only heard, as if seen
             (``as_seen``), which is a lie about the source and is marked ``"lie": true``. The
             action takes five ways (``speak.HOWS``: also with more drama, without the source and
             made up), and the bots use them all, but the town puts forward these two.
``entrust``  what this person can be asked: to bring the bamboo or the timber, to open the lane,
             to lend the bamboo, to testify (anyone the script gives a testimony), to join the
             helpers, to talk an acquaintance round, to call the clan.
``promise``  what the manager still has to promise, for the day after next, and what is open to
             this person to be kept.
``speak``    to show all the evidence held, or one item of it, to make the full statement of the
             card, and to lay a table for the two families.

The frame's ``player`` also has ``topics``, what the manager can ask about now (``topics``): in a
conversation, the entries of the notebook, the things of the story, the bridge and the people,
each ``{"id", "kind", "label": {"zh", "en"}}`` with ``kind`` one of ``entry``, ``thing``,
``place`` and ``person``, then a question about what a person likes (``taste``, the id
``likes:<person>``, for each person the manager has a card of and has not learned the tastes of in
full, other than the one they talk to, see ``gifts``), and an empty list outside a conversation. It
is a list of what ``ask`` takes: every id in it is one the core answers, and a person of the cast
that the script does not name (Shitou) is not in it.

``request_label`` words a request to a named person ("Ask Li Da to bring the bamboo to the
bridge"), for the request that the talk puts first (``context``).
"""

from __future__ import annotations

import functools
from typing import Any

from lantern_core.cognition.beliefs import Belief, BeliefStore
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import (
    assembly,
    goals,
    goals_call,
    goals_work,
    notebook,
    notes,
    numerals,
    pledges,
    prompts,
    retell,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import Lore, lore

MAX_ENTRIES = 24
MAX_TARGETS = 8
VERBS = ("tell", "entrust", "promise", "speak")
BRIDGE = "p_bridge"  # the one place that the manager can ask about
TOPIC_KINDS = ("entry", "thing", "place", "person", "taste")
ROLE_NAMES = {
    "t_honor_light": {"zh": "点主灯的体面差事", "en": "the honour of lighting the main lantern"},
    "lead_lanterns": {"zh": "领游灯的体面差事", "en": "the honour of leading the lantern parade"},
    "stage_words": {
        "zh": "上台说吉祥话的体面差事",
        "en": "the honour of speaking the blessings on stage",
    },
}
ITEM_NAMES = {
    "bamboo": {"zh": "竹料", "en": "bamboo"},
    "timber": {"zh": "木料", "en": "timber"},
}


def _label(zh: str, en: str) -> dict[str, str]:
    return {"zh": zh, "en": en}


def request_label(person: str, body: dict[str, Any]) -> dict[str, str]:
    """A request (the body of an offer of ``entrust``) to ``person``, in words that name them."""
    names = lore().names
    who, kind = names[person], body["kind"]
    if kind == "material":
        thing = ITEM_NAMES[goals_work.SUPPLIERS[person][0]]
        return _label(
            f"请{who['zh']}把{thing['zh']}送到桥边",
            f"Ask {who['en']} to bring the {thing['en']} to the bridge",
        )
    if kind == "lane":
        return _label(
            f"请{who['zh']}打开庙后的夹道", f"Ask {who['en']} to open the lane behind the temple"
        )
    if kind == "lend":
        return _label(
            f"请{who['zh']}把竹料借出来", f"Ask {who['en']} to lend the bamboo for the bridge"
        )
    if kind == "testify":
        return _label(f"请{who['zh']}说说亲眼看见了什么", f"Ask {who['en']} to tell what they saw")
    if kind == "join":
        return _label(f"请{who['zh']}来帮忙", f"Ask {who['en']} to join the helpers")
    if kind == "persuade":
        target = names[body["target"]]
        return _label(
            f"请{who['zh']}去劝{target['zh']}", f"Ask {who['en']} to talk {target['en']} round"
        )
    return _label(f"请{who['zh']}把族人召到祠堂", f"Ask {who['en']} to call the clan to the hall")


def _offer(offer_id: str, label: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
    return {"id": offer_id, "label": label, "body": body}


@functools.lru_cache(maxsize=4096)
def sharpenable(prop: Prop) -> bool:
    """Whether the prop has a heavier version to tell it with (see ``speak.sharpened``)."""
    lo: Lore = lore()
    view = notes.PropView({prop.id: prop}, lo.book.props)
    belief = Belief("player", prop.id, "assert", 60, "saw", None, None, 0, 0)
    changes = retell.changes(
        lo,
        view,
        prop,
        belief,
        BeliefStore("player"),
        suspicion=0,
        relation=lambda kind, holder, target: False,
    )
    return any(change.op in ("sharpen", "fill") for change in changes)


# ---------------------------------------------------------------------------- tell


_TOLD: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
MAX_KEPT = 16


def tell(world_state: dict[str, Any]) -> list[dict[str, Any]]:
    """The offers of ``tell``. They depend on the entries alone (and on the props made on the way
    that they say, since an id means what the game that made it says), so the list made for a
    notebook is kept and handed out again while it is the same; a caller must not change what it
    gets."""
    section, made = world_state["player"], world_state["social"]["props"]
    key = tuple(
        (e["id"], e["prop"], notebook.belief_of(e).source == "saw", made.get(e["prop"]))
        for e in section["notebook"][-MAX_ENTRIES:]
    )
    made = _TOLD.get(key)
    if made is None:
        made = _tell(world_state)
        if len(_TOLD) >= MAX_KEPT:
            _TOLD.clear()
        _TOLD[key] = made
    return made


def _tell(world_state: dict[str, Any]) -> list[dict[str, Any]]:
    section, social = world_state["player"], world_state["social"]
    view = notebook.view(social)
    out: list[dict[str, Any]] = []
    for entry in section["notebook"][-MAX_ENTRIES:]:
        text = notebook.sentence(view[entry["prop"]])
        said = _label("照实说：" + text["zh"], "Tell it as it is: " + text["en"])
        out.append(
            _offer(f"{entry['id']}:faithful", said, {"entry": entry["id"], "how": "faithful"})
        )
        if notebook.belief_of(entry).source != "saw":  # told as seen, it is a lie about the source
            seen = _label("说成我亲眼看见的：" + text["zh"], "Say I saw it myself: " + text["en"])
            offer = _offer(f"{entry['id']}:as_seen", seen, {"entry": entry["id"], "how": "as_seen"})
            offer["lie"] = True
            out.append(offer)
    return out


# ---------------------------------------------------------------------------- entrust


def _request(offer_id: str, person: str, body: dict[str, Any]) -> dict[str, Any]:
    """The offer of a request ``body`` to ``person``, worded with their name."""
    return _offer(offer_id, request_label(person, body), body)


def entrust(world: Any, world_state: dict[str, Any], person: str) -> list[dict[str, Any]]:
    layout, out = goals_call.lay(world), []
    if person in goals_work.SUPPLIERS:
        out.append(_request("material", person, {"kind": "material"}))
    if person == goals_work.KEEPER:
        out.append(_request("lane", person, {"kind": "lane"}))
    if person == "li_laotai":
        out.append(_request("lend", person, {"kind": "lend"}))
    if any(item["acquire"]["from"] == person for item in SCRIPT["evidence"]):
        out.append(_request("testify", person, {"kind": "testify"}))
    joined = goals.joined(world_state)
    if person in layout.helpers and person not in joined:
        out.append(_request("join", person, {"kind": "join"}))
    if person in layout.helpers:
        targets = [b for b in layout.knows.get(person, ()) if b not in joined][:MAX_TARGETS]
        for target in targets:
            body = {"kind": "persuade", "target": target}
            out.append(_request(f"persuade:{target}", person, body))
    if person == assembly.ELDER:
        out.append(_request("convene", person, {"kind": "convene"}))
    return out


# ---------------------------------------------------------------------------- promise


def promise_offer(
    world: Any,
    section: dict[str, Any],
    day: int,
    what: str,
    item: str = "",
    amount: int = 0,
    *,
    person: str,
) -> dict[str, Any] | None:
    """The offer to promise ``person`` ``what`` (``stall``, ``role``, ``wage`` or ``slot``) with its
    ``item`` and, for a wage, its coins, due the day after next, or None if the manager holds none
    of it. A place in the programme with no ``item`` is the first one that is free."""
    have = pledges.left(section)
    due = min(world.config["days"], day + 2)
    if what == "slot" and not item and have["slots"]:
        item = have["slots"][0]
    if not pledges.holds(section, what, item, amount):
        return None
    body: dict[str, Any] = {"op": "make", "due": due, "what": what}
    who = lore().names[person]
    if what == "stall":
        row = "front" if item == "front" else "back"
        label = (
            _label(f"许{who['zh']}一个前排摊位", f"Promise {who['en']} a front-row stall")
            if row == "front"
            else _label(f"许{who['zh']}一个后排摊位", f"Promise {who['en']} a back-row stall")
        )
        return _offer(f"stall:{row}", label, {**body, "item": row})
    if what == "role":
        name = ROLE_NAMES[item]
        label = _label(f"许{who['zh']}{name['zh']}", f"Promise {who['en']} {name['en']}")
        return _offer(f"role:{item}", label, {**body, "item": item})
    if what == "wage":
        label = _label(
            f"许{who['zh']}{numerals.zh_count(amount)}文工钱",
            f"Promise {who['en']} {amount} coins in wages",
        )
        return _offer(f"wage:{amount}", label, {**body, "amount": amount})
    label = _label(
        f"许{who['zh']}节目单上第{numerals.zh_ordinal(int(item))}位",
        f"Promise {who['en']} slot {item} of the programme",
    )
    return _offer(f"slot:{item}", label, {**body, "item": item})


def promise(world: Any, world_state: dict[str, Any], person: str, day: int) -> list[dict[str, Any]]:
    section, out = world_state["player"], []
    have = pledges.left(section)
    wanted: list[tuple[str, str, int]] = [("stall", "front", 0), ("stall", "back", 0)]
    wanted += [("role", role, 0) for role in have["roles"]]
    wanted += [("wage", "", amount) for amount in (10, 20)]
    wanted += [("slot", "", 0)]
    for what, item, amount in wanted:
        offer = promise_offer(world, section, day, what, item, amount, person=person)
        if offer is not None:
            out.append(offer)
    for pledge in section["pledges"]:
        if pledge["to"] == person and pledge["state"] == pledges.OPEN:
            what = prompts.promise_text(
                world, pledge["what"], pledge["item"], pledge["amount"], town=True
            )
            who = lore().names[person]
            label = _label(
                f"兑现许诺，给{who['zh']}{what['zh']}",
                f"Keep your promise to {who['en']}: {what['en']}",
            )
            out.append(_offer(f"keep:{pledge['id']}", label, {"op": "keep", "id": pledge["id"]}))
    return out


# ---------------------------------------------------------------------------- speak


def speak(world_state: dict[str, Any]) -> list[dict[str, Any]]:
    section = world_state["player"]
    out: list[dict[str, Any]] = []
    held = [item for item in SCRIPT["evidence"] if item["id"] in section["evidence"]]
    if held:
        label = _label("把手里的凭据都拿出来", "Show everything you hold")
        out.append(_offer("all", label, {"kind": "evidence"}))
    if len(held) > 1:
        for item in held:
            label = _label("拿出「" + item["label"] + "」", "Show: " + item["label_en"])
            out.append(
                _offer(f"item:{item['id']}", label, {"kind": "evidence", "evidence": [item["id"]]})
            )
    out.append(
        _offer(
            "statement",
            _label("照讲稿当众说", "Make the statement"),
            {"kind": "statement"},
        )
    )
    out.append(_offer("meal", _label("摆一桌和解饭", "Lay a table for peace"), {"kind": "meal"}))
    return out


# ---------------------------------------------------------------------------- topics


def _topic(topic_id: str, kind: str, label: dict[str, str]) -> dict[str, Any]:
    return {"id": topic_id, "kind": kind, "label": label}


@functools.lru_cache(maxsize=4)
def _standing(cast: Any, town: Any) -> tuple[dict[str, Any], ...]:
    """The topics that do not change in a game: the things, the bridge and the people.

    Only what the script names is here, since ``ask`` refuses any other id
    (``answers.topic_known``).
    """
    registry = lore().book.registry
    found = [
        _topic(e.id, "thing", _label(e.label, e.label_en or e.id))
        for e in registry.of_type("thing")
    ]
    place = town.places[BRIDGE]
    if registry.get(place.id) is not None:
        found.append(_topic(place.id, "place", _label(place.zh, place.en)))
    found += [
        _topic(p.id, "person", _label(p.zh, p.en))
        for p in cast.people
        if registry.get(p.id) is not None
    ]
    return tuple(found)


def topics(
    world: Any, entries: list[dict[str, Any]], tastes: list[dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    """What the manager can ask about in a conversation: the entries of the notebook, as the frame
    shows them (``notebook.wire``), then the things, the bridge and the people, then the questions
    about what a person likes (``tastes``, made by ``gifts.topics``)."""
    mine = [_topic(e["id"], "entry", e["text"]) for e in entries]
    return [*mine, *_standing(world.cast, world.town), *(tastes or ())]


# ---------------------------------------------------------------------------- the frame


def build(world: Any, world_state: dict[str, Any], now: Any) -> dict[str, list[dict[str, Any]]]:
    """The offers of every verb for the frame, empty where the verb cannot be used."""
    section = world_state["player"]
    out: dict[str, list[dict[str, Any]]] = {verb: [] for verb in VERBS}
    talk = section["talk"]
    if talk:
        out["tell"] = tell(world_state)
        out["entrust"] = entrust(world, world_state, talk["npc"])
        out["promise"] = promise(world, world_state, talk["npc"], now.day)
    elif assembly.open_here(world, world_state, now):
        out["speak"] = speak(world_state)
    return out
