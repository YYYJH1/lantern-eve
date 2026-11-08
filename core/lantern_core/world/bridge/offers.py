"""What the town puts forward for each verb that takes a choice: the offers of the frame.

The frame's ``player`` has ``offers``, ``{verb: [offer]}`` for the verbs ``tell``, ``entrust``,
``promise`` and ``speak``, and an offer is ``{"id": str, "label": {"zh", "en"}, "body": {...}}``:
the label to show and the fields of the action to send when it is chosen (the page adds ``type``
and ``action_id``). A verb has offers only where it can be used: the first three in a
conversation, the last where the manager may speak in public. Nothing here depends on which
variant of the story is true.

``tell``     for each entry of the notebook (the last ``MAX_ENTRIES``), the ways besides telling it
             as it is, which the page's own list of entries already does: as if seen, if the
             manager did not see it, without the source, if it was heard, and with more drama, if
             a heavier version exists; and a few things to make up, all about who damaged the
             stone rail.
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
``place`` and ``person``, and an empty list otherwise. It is a list of what ``ask`` takes: every
id in it is one the core answers, and a person of the cast that the script does not name (Shitou)
is not in it.
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
TOPIC_KINDS = ("entry", "thing", "place", "person")
ROLE_NAMES = {
    "t_honor_light": {"zh": "点主灯的体面", "en": "the honour of lighting the main lantern"},
    "lead_lanterns": {"zh": "领游灯", "en": "leading the lantern parade"},
    "stage_words": {"zh": "台上说吉祥话", "en": "speaking the blessings on stage"},
}
ITEM_NAMES = {
    "bamboo": {"zh": "竹料", "en": "bamboo"},
    "timber": {"zh": "木料", "en": "timber"},
}
# who the made-up blame can fall on
BLAMED = ("li_er", "zhou_dalang", "old_he", "fam_li", "fam_zhou")
RAIL = "t_rail"
MAKE_UP_FLOOD = {"how": "fabricate", "pred": "flood_damaged", "subject": RAIL}


def _label(zh: str, en: str) -> dict[str, str]:
    return {"zh": zh, "en": en}


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
    section, social, lo = world_state["player"], world_state["social"], lore()
    view = notebook.view(social)
    out: list[dict[str, Any]] = []
    for entry in section["notebook"][-MAX_ENTRIES:]:
        prop = view[entry["prop"]]
        text = notebook.sentence(prop)
        heard = notebook.belief_of(entry).source != "saw"
        ways = []
        if heard:
            ways.append(("as_seen", "说成亲眼所见：", "As if you saw it: "))
            ways.append(("hide_source", "不说来源：", "Without the source: "))
        if sharpenable(prop):
            ways.append(("sharpen", "添油加醋：", "Heavier: "))
        for how, zh, en in ways:
            label = _label(zh + text["zh"], en + text["en"])
            out.append(_offer(f"{entry['id']}:{how}", label, {"entry": entry["id"], "how": how}))
    for who in BLAMED:
        body = {"how": "fabricate", "pred": "damaged", "subject": who, "object": RAIL}
        prop = Prop.of("_", "damaged", {"who": who, "what": RAIL})
        said = lo.lines.statement(prop, lo.names)
        label = _label("编一个：" + said["zh"], "Make up: " + said["en"])
        out.append(_offer(f"fab:damaged:{who}", label, body))
    flood = lo.lines.statement(Prop.of("_", "flood_damaged", {"what": RAIL}), lo.names)
    out.append(
        _offer(
            "fab:flood", _label("编一个：" + flood["zh"], "Make up: " + flood["en"]), MAKE_UP_FLOOD
        )
    )
    return out


# ---------------------------------------------------------------------------- entrust


def entrust(world: Any, world_state: dict[str, Any], person: str) -> list[dict[str, Any]]:
    layout, out = goals_call.lay(world), []
    names = lore().names
    if person in goals_work.SUPPLIERS:
        item = goals_work.SUPPLIERS[person][0]
        thing = ITEM_NAMES[item]
        label = _label(
            f"请对方把{thing['zh']}送到桥边", f"Ask them to bring the {thing['en']} to the bridge"
        )
        out.append(_offer("material", label, {"kind": "material"}))
    if person == goals_work.KEEPER:
        label = _label("请她打开庙后的夹道", "Ask her to open the lane behind the temple")
        out.append(_offer("lane", label, {"kind": "lane"}))
    if person == "li_laotai":
        label = _label("请她把竹料借给灯会", "Ask her to lend the bamboo for the bridge")
        out.append(_offer("lend", label, {"kind": "lend"}))
    if any(item["acquire"]["from"] == person for item in SCRIPT["evidence"]):
        out.append(
            _offer(
                "testify",
                _label("请对方说说亲眼所见", "Ask them to tell what they saw"),
                {"kind": "testify"},
            )
        )
    joined = goals.joined(world_state)
    if person in layout.helpers and person not in joined:
        out.append(
            _offer(
                "join", _label("请对方加入帮工", "Ask them to join the helpers"), {"kind": "join"}
            )
        )
    if person in layout.helpers:
        targets = [b for b in layout.knows.get(person, ()) if b not in joined][:MAX_TARGETS]
        for target in targets:
            label = _label(
                f"请对方去劝{names[target]['zh']}", f"Ask them to talk {names[target]['en']} round"
            )
            out.append(_offer(f"persuade:{target}", label, {"kind": "persuade", "target": target}))
    if person == assembly.ELDER:
        label = _label("请族长召集族里的人到祠堂", "Ask the elder to call the clan to the hall")
        out.append(_offer("convene", label, {"kind": "convene"}))
    return out


# ---------------------------------------------------------------------------- promise


def promise(world: Any, world_state: dict[str, Any], person: str, day: int) -> list[dict[str, Any]]:
    section, out = world_state["player"], []
    due = min(world.config["days"], day + 2)
    have = pledges.left(section)

    def make(offer_id: str, label: dict[str, str], **fields: Any) -> None:
        out.append(_offer(offer_id, label, {"op": "make", "due": due, **fields}))

    if have["stall_front"] > 0:
        make(
            "stall:front",
            _label("许对方一个前排摊位", "Promise a front-row stall"),
            what="stall",
            item="front",
        )
    if have["stall_back"] > 0:
        make(
            "stall:back",
            _label("许对方一个后排摊位", "Promise a back-row stall"),
            what="stall",
            item="back",
        )
    for role in have["roles"]:
        name = ROLE_NAMES[role]
        make(
            f"role:{role}",
            _label("许对方" + name["zh"], "Promise " + name["en"]),
            what="role",
            item=role,
        )
    for amount in (10, 20):
        if amount <= have["purse"]:
            label = _label(
                f"许对方{numerals.zh_count(amount)}文工钱", f"Promise {amount} coins in wages"
            )
            make(f"wage:{amount}", label, what="wage", amount=amount)
    if have["slots"]:
        slot = have["slots"][0]
        label = _label(
            f"许对方节目单上第{numerals.zh_ordinal(int(slot))}位",
            f"Promise slot {slot} of the programme",
        )
        make(f"slot:{slot}", label, what="slot", item=slot)
    for pledge in section["pledges"]:
        if pledge["to"] == person and pledge["state"] == pledges.OPEN:
            what = prompts.promise_text(
                world, pledge["what"], pledge["item"], pledge["amount"], town=True
            )
            label = _label("兑现许诺：" + what["zh"], "Keep your promise: " + what["en"])
            out.append(_offer(f"keep:{pledge['id']}", label, {"op": "keep", "id": pledge["id"]}))
    return out


# ---------------------------------------------------------------------------- speak


def speak(world_state: dict[str, Any]) -> list[dict[str, Any]]:
    section = world_state["player"]
    out: list[dict[str, Any]] = []
    held = [item for item in SCRIPT["evidence"] if item["id"] in section["evidence"]]
    if held:
        label = _label("把手里的证据都拿出来", "Show everything you hold")
        out.append(_offer("all", label, {"kind": "evidence"}))
    if len(held) > 1:
        for item in held:
            label = _label("出示：" + item["label"], "Show: " + item["label_en"])
            out.append(
                _offer(f"item:{item['id']}", label, {"kind": "evidence", "evidence": [item["id"]]})
            )
    out.append(
        _offer(
            "statement",
            _label("作完整陈述", "Make the full statement"),
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


def topics(world: Any, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What the manager can ask about in a conversation: the entries of the notebook, as the frame
    shows them (``notebook.wire``), then the things, the bridge and the people."""
    mine = [_topic(e["id"], "entry", e["text"]) for e in entries]
    return [*mine, *_standing(world.cast, world.town)]


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
