"""Previews: what an action would ask, give and cost, and what stands in its way, before it is made.

``Game.preview_json`` takes the action a page is about to send, ``{"verb", "npc", ...}``, and
answers with one object::

    {"version": int,                 the version of the state the preview was made on
     "cost": int | null,             the game minutes the action takes, where the game has a table
     "asks": {"zh", "en"},           what is asked of the person
     "gives": {"zh", "en"} | null,   what the manager gives for it
     "blockers": [{"zh", "en"}],     what stands in the way, as far as the manager can know
     "odds": "high" | "mid" | "low" | null,
     "reasons": [{"sign": 1 | -1, "text": {"zh", "en"}}]}

The verbs are ``ask``, ``ask_source``, ``tell``, ``entrust`` and ``promise``, with the fields the
action has (``topic``, ``entry``, ``how``, ``kind``, ``target``, ``what``, ``item``, ``amount``,
``due``, ``op`` and ``id``), and ``npc``, the person of the talk. ``offer`` is the promise that the
page would have the manager give for a request. It is said in ``gives`` and counted for nothing,
since a request is weighed as it stands (a promise is made with the action ``promise``, and the
preview that follows counts it). ``item`` and ``cite`` are not read either: what a citation is
worth depends on what the person believes, which a preview does not look at.

A preview only reads. It asks no model, draws nothing from the RNG and writes nothing to the state,
so the hash of the game is the same before and after (a test holds ten of them to that). It reads
the rules the action will be settled by and the state of the manager's own dealings, and nothing
else: the variant that is true, what the people believe and what is between them stay out of it.
What it says stands on what the person would say aloud or what the manager already knows.

The ``odds`` are those of the score a request is weighed by (``persuade``), without the worth of a
citation and without a judge of the manager's words. They are ``high`` if the sum is five over the
price, ``low`` if it is five short of it or the way is shut, and ``mid`` between. A request to join
the helpers is ``high`` only if it is ten over (``entrust.JOIN_MARGIN``), since less only moves the
person. A question, a telling and a promise have no odds.

A request to testify is previewed from what the script gives the person to tell, and not from what
is real in this game: whether they saw anything is for them to say, and the preview does not say.

The request for the goods (``entrust`` of the kind ``material``) says what a yes would bring and by
when, as a sentence at the end of ``asks``, in a game that has the goods promised for a time (``If
Li Da agrees, 4 poles come by 7 tomorrow morning.``), from the rules of the commitments
(``commitments.terms``). A person who has promised already would promise nothing: the blocker says
what they promised, with the amount, what it is and by when (``Li Da has promised already: 4 poles
of bamboo, by 7 tomorrow morning``), and when the bridge has all it needs of the item it says so
(``commitments.standing``).
Those are the two things the person says to the request, which is rejected as ``said_already`` all
the same. For Li Da the blockers are all that stands in the way of his yes, in the order of
``objection.GAPS``: his mother's objection, his not knowing of the clarification, his distrust.

Versions. ``version`` is one more than the tick and the number of events so far. Both only grow, so
it changes whenever time passes or anything happens, and stays the same while nothing does: a
preview holds for as long as the world is held. (A conversation holds it, so a preview made in one
holds until the manager acts, and so does a pause of the host; outside a conversation, and while
an act is being paid for, time passes and every preview is stale at the next tick.) ``ask``,
``ask_source``,
``tell``, ``entrust`` and ``promise`` take ``"version"`` along with ``"action_id"``. If it is not
the version of the state when the action is applied, the action is rejected as ``stale``, nothing
else happens, and the page previews again. A version of 0, or none, is not checked: a page that made
the preview itself, because the host had none, sends 0. The same ``action_id`` again is answered
``duplicate`` by the kernel and does nothing.

The cost is the game minutes that the act takes (``pace.minutes``, the ``act_minutes`` of the
script), never null for the five acts: the world owes them once the person has answered, and the
preview does not say whether they will. It is also the time that the arrival of goods is counted
from: a promise is made when the act is over (see ``commitments``).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING, Any

from lantern_core.cognition.lines import capitalise
from lantern_core.inputs import InputError, int_field
from lantern_core.world.bridge import (
    agenda,
    agenda_facts,
    answers,
    clock,
    commitments,
    converse,
    entrust,
    evidence,
    gifts,
    goals_work,
    notebook,
    numerals,
    objection,
    offers,
    pace,
    persuade,
    pledges,
    repute,
    speak,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.prompts import promise_text, request_text

if TYPE_CHECKING:
    from lantern_core.world.bridge.world import BridgeWorld

VERBS = ("ask", "ask_source", "tell", "entrust", "promise")
MAX_VERSION = 2**53
ODDS_MARGIN = 5  # over the price: high; short of it by this much or more: low
KNOWN_TRUST = repute.STRANGER + 10  # from this far a person is said to trust the manager a little

Words = dict[str, str]


# ---------------------------------------------------------------------------- versions


def version_of(state: Mapping[str, Any]) -> int:
    """The version of the state of a game (``state`` is the kernel's): it changes when time passes
    and when anything is emitted, and never otherwise."""
    return int(state["tick"]) + int(state["version"]) + 1


def stale(state: Mapping[str, Any], body: Mapping[str, Any]) -> bool:
    """Whether an action carries a version that is not the one of the state it is applied to."""
    claimed = body.get("version")
    return bool(claimed) and claimed != version_of(state)


def versioned(
    validate: Callable[[Any, dict[str, Any]], dict[str, Any]],
) -> Callable[[Any, dict[str, Any]], dict[str, Any]]:
    """``validate`` for an action that may carry the version of the state it was previewed on."""

    def run(world: Any, body: dict[str, Any]) -> dict[str, Any]:
        out = validate(world, body)
        if "version" in body:
            where = f"player action {out['type']}"
            out["version"] = int_field(body["version"], where, "version", 0, MAX_VERSION)
        return out

    return run


def reject_if_stale(sim: Any, body: dict[str, Any]) -> bool:
    """Answer an action that carries an old version as ``stale``. True if it did."""
    if not stale(sim.ctx.state, body):
        return False
    converse.ack(sim, body, "stale")
    return True


# ---------------------------------------------------------------------------- words


def _w(zh: str, en: str) -> Words:
    return {"zh": zh, "en": en}


def _name(person: str) -> Words:
    return dict(lore().names[person])


def _sentence(zh: str, en: str, person: str) -> Words:
    """A sentence about a person, from texts with ``{n}`` for their name."""
    name = _name(person)
    return _w(zh.format(n=name["zh"]), capitalise(en.format(n=name["en"])))


def _then(first: Words, second: Words) -> Words:
    return _w(first["zh"] + second["zh"], first["en"] + second["en"])


def _quoted(first: Words, second: Words, close: str) -> Words:
    """``second`` after ``first``, and in Chinese closed by ``close``: the words quoted, without a
    full stop of their own, as in 对李大说「李二昨晚在桥边」 (the English keeps the colon)."""
    return _w(first["zh"] + second["zh"].rstrip("。") + close, first["en"] + second["en"])


def _reason(sign: int, zh: str, en: str, person: str) -> dict[str, Any]:
    return {"sign": sign, "text": _sentence(zh, en, person)}


def _by(today: int, day: int, hour: int) -> Words:
    """ "By" a day and an hour, said from ``today``: by 13:00 today, by 7 tomorrow morning. In
    Chinese the hour is a clock time as in the words of a promise (``commitments.when_words``):
    今天13:00前, 明早07:00前, 第四天07:00前. Beyond tomorrow the words are those of the promise in
    both languages."""
    at = f"{hour:02d}:00"
    if day == today:
        return _w(f"今天{at}前", f"by {hour}:00 today")
    if day == today + 1:
        if hour < 12:
            return _w(f"明早{at}前", f"by {hour} tomorrow morning")
        return _w(f"明天{at}前", f"by {hour}:00 tomorrow")
    return commitments.when_words(day, hour)


def _arrival(view: View, person: str) -> Words | None:
    """What a yes would bring and by when, in a game that has the goods promised for a time (see
    ``commitments``), as a sentence after the request: ``If Li Da agrees, 4 poles come by 7
    tomorrow morning.`` None where the person would promise nothing (they have a promise open, or
    the bridge lacks none of it). The promise is made when the act is over, so the time is counted
    from the clock as it will stand once the world has paid for the minutes of the request, as the
    real promise counts it."""
    over = clock.after(view.state, view.ctx.tick, pace.minutes("entrust") * 60)
    found = commitments.terms(view.state, over, person)
    if found is None:
        return None
    name, when, amount = (
        _name(person),
        _by(view.now.day, found["day"], found["hour"]),
        found["amount"],
    )
    return _w(
        f"。要是答应，{when['zh']}先送{numerals.zh_count(amount)}根。",
        f". If {name['en']} agrees, {amount} poles come {when['en']}.",
    )


def _standing_blocker(view: View, person: str) -> Words:
    """Why a request for goods is turned away before it is weighed, with the numbers: that the
    person has promised already (the amount, what it is, and by when), or that the bridge has all
    it needs of the item. What the person says to it is the line of the same meaning."""
    held = commitments.standing(view.state, person)
    assert held is not None
    row = held[1]
    if row is not None:
        item = commitments.item_words(row["item"])
        when = _by(view.now.day, row["due"]["day"], row["due"]["hour"])
        return _sentence(
            f"{{n}}已经答应了，{when['zh']}送{numerals.zh_count(row['amount'])}根{item['zh']}",
            f"{{n}} has promised already: {row['amount']} poles of {item['en']}, {when['en']}",
            person,
        )
    item = commitments.item_words(goals_work.SUPPLIERS[person][0])
    return _w(f"桥边的{item['zh']}已经够了", f"There is enough {item['en']} at the bridge already")


# what stands in the way, by the code of the reason it is turned down for
BLOCKS: dict[str, tuple[str, str]] = {
    "not_talking": ("你们还没说上话", "you are not talking to {n} yet"),
    "closed_way": ("{n}还不肯松口", "{n} will not give way yet"),
    "needs_nod": (
        "{n}要等李老太松口才肯答应。先把李二的事当众说清",
        "{n} will not move until Granny Li no longer stands in the way. "
        "First set the talk about Li Er straight in public",
    ),
    "unaware": (
        "{n}还没听说那话已经当众说清了。去告诉{n}一声",
        "{n} has not heard that it was cleared up in public. Go and tell {n}",
    ),
    "distrust": ("{n}还不大信你，这会儿开口太早", "{n} does not trust you enough to be asked yet"),
    "cannot": ("{n}帮不上这个忙", "{n} cannot help with that"),
    "nothing_to_say": ("{n}没什么可说的", "{n} has nothing to say about that"),
    "said_already": ("这件事{n}已经答复过了", "{n} has answered this already"),
    "too_late": ("天色已晚，今天来不及了", "it is too late today"),
    "closed": ("这个时辰不方便", "this is not a good hour"),
    "refused": ("{n}还不大信你", "{n} does not trust you enough yet"),
    "needs": ("得先拿到别的凭据", "something else has to be in hand first"),
    "no_entry": ("见闻簿里没有这一条", "your notebook has no such entry"),
    "no_request": ("这件事办不了", "that cannot be asked"),
    "unknown_topic": ("这个没法问", "there is no asking about that"),
    "no_sharpen": ("这句话已经没法说得更重了", "there is no heavier way to say that"),
    "bad_claim": ("这句话编不出来", "that cannot be made up"),
    "empty": ("这个你手里没有，许下也是空话", "you hold nothing like that to promise"),
    "bad_due": ("期限不对", "that is not a possible day"),
    "no_pledge": ("没有这条许诺", "there is no such promise"),
    "wrong_person": ("这条许诺不是许给{n}的", "that promise was not made to {n}"),
    "kept_already": ("这条许诺已经兑现了", "that promise is kept already"),
    "lapsed": ("这条许诺已经过期了", "that promise has lapsed"),
}


def _blocker(code: str, person: str) -> Words:
    zh, en = BLOCKS[code]
    return _sentence(zh, en, person)


# ---------------------------------------------------------------------------- what the rules read


class _Ctx:
    __slots__ = ("state", "tick")

    def __init__(self, state: Mapping[str, Any]) -> None:
        self.state = state
        self.tick = state["tick"]


class View:
    """The little of a ``Sim`` that the rules read when they only look: the world, the state of the
    world, the time and the tick. Nothing here can emit an event or draw a number."""

    __slots__ = ("ctx", "now", "state", "world")

    def __init__(self, world: BridgeWorld, state: Mapping[str, Any]) -> None:
        self.world = world
        self.state: dict[str, Any] = state["world"]
        self.now = clock.at(state["tick"])
        self.ctx = _Ctx(state)


def cost_of(state: Mapping[str, Any], verb: str) -> int | None:
    """The game minutes the verb takes (``pace.minutes``): always for the five acts of a talk."""
    return pace.minutes(verb) if verb in pace.IN_TALK else None


def _topic_text(world_state: Mapping[str, Any], topic: str) -> Words:
    props = notebook.view(world_state["social"])
    if topic in props:
        return notebook.sentence(props[topic])
    return dict(lore().names.get(topic) or {"zh": topic, "en": topic})


def _tasks_blocked_for(
    world: BridgeWorld, world_state: Mapping[str, Any], person: str
) -> list[Words]:
    """What the manager's own tasks say blocks them: the blocker of each task that is blocked and
    names the person in one of its actions, or in one of the actions its blocker offers, and after
    it the step that the task gives for getting past it, in the task's own words."""
    section = world_state[agenda.SECTION]
    rows = section["tasks"] if section else {}
    facts: agenda_facts.Facts | None = None
    found: list[Words] = []
    for task_id in agenda.book().order:
        row = rows.get(task_id)
        if row is None or row["state"] != agenda.BLOCKED:
            continue
        task = agenda.book().by_id[task_id]
        rule = task["blocked"][row["rule"]]
        if any(option["npc"] == person for option in [*task["action"], *rule["action"]]):
            said = _w(rule["blocker"]["zh"], rule["blocker"]["en"])
            step = agenda.pick(agenda.options_of(task, row["rule"], "next"), row["next"])
            if step is not None:
                facts = facts or agenda_facts.Facts(world, dict(world_state))
                to_do = agenda.told(step, facts)
                said = _w(f"{said['zh']}。{to_do['zh']}", f"{said['en']}. {to_do['en']}")
            if said not in found:
                found.append(said)
    return found


def _talking_to(world_state: Mapping[str, Any], person: str) -> bool:
    talk = world_state["player"]["talk"]
    return bool(talk) and talk["npc"] == person


def _out(
    state: Mapping[str, Any],
    verb: str,
    asks: Words,
    gives: Words | None = None,
    blockers: list[Words] | None = None,
    odds: str | None = None,
    reasons: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "version": version_of(state),
        "cost": cost_of(state, verb),
        "asks": asks,
        "gives": gives,
        "blockers": blockers or [],
        "odds": odds,
        "reasons": reasons or [],
    }


# ---------------------------------------------------------------------------- asking and telling


def _ask(state: Mapping[str, Any], body: dict[str, Any], person: str) -> dict[str, Any]:
    ws = state["world"]
    topic = body["topic"]
    entry = notebook.find(ws["player"], topic)
    blockers: list[Words] = []
    taste = gifts.is_taste(topic) and entry is None
    if entry is not None:
        topic = entry["prop"]
    elif taste:
        if gifts.target_of(topic) not in lore().index or gifts.target_of(topic) == person:
            blockers.append(_blocker("unknown_topic", person))
    elif not answers.topic_known(topic, notebook.view(ws["social"])):
        blockers.append(_blocker("unknown_topic", person))
    quoted = False  # a note is a sentence, and is quoted: 向李大打听「李二昨晚在桥边」
    if blockers:
        text = _w("这件事", "that")
    elif taste:
        text = gifts.label(gifts.target_of(topic))
    else:
        text = _topic_text(ws, topic)
        quoted = topic in notebook.view(ws["social"])
    if not _talking_to(ws, person):
        blockers.append(_blocker("not_talking", person))
    if quoted:
        asks = _quoted(_sentence("向{n}打听「", "ask {n} about: ", person), text, "」")
    else:  # a person, a thing or a place, or what someone likes: 向李大打听李二
        asks = _then(_sentence("向{n}打听", "ask {n} about: ", person), text)
    return _out(state, "ask", asks, blockers=blockers)


def _ask_source(state: Mapping[str, Any], body: dict[str, Any], person: str) -> dict[str, Any]:
    ws = state["world"]
    entry = notebook.find(ws["player"], body["entry"])
    blockers: list[Words] = []
    if entry is None:
        blockers.append(_blocker("no_entry", person))
        text = _w("这件事", "that")
    else:
        text = notebook.sentence(notebook.view(ws["social"])[entry["prop"]])
    if not _talking_to(ws, person):
        blockers.append(_blocker("not_talking", person))
    asks = _quoted(_sentence("问{n}「", "ask {n} who told them: ", person), text, "」是听谁说的")
    return _out(state, "ask_source", asks, blockers=blockers)


# the risks and the gains of the ways of telling, which the rules fix and anyone can know
TELLING: dict[str, tuple[tuple[int, str, str], ...]] = {
    "as_seen": (
        (1, "说是亲眼看见的，听的人更信", "said as something you saw, it is believed more"),
        (
            -1,
            "没亲眼看见却说成亲眼看见，是撒谎。有人知道实情，你就会被拆穿",
            "saying you saw what you only heard is a lie, and anyone holding proof against it "
            "catches you",
        ),
    ),
    "hide_source": (
        (
            -1,
            "不说是听谁说的，听的人会少信几分",
            "told without a source, it is believed a little less",
        ),
    ),
    "sharpen": (
        (-1, "说得更重，话传出去就更走样", "the heavier the telling, the further it drifts"),
    ),
    "fabricate": (
        (
            -1,
            "凭空编的话是撒谎。被拆穿了，知道的人就不那么信你了",
            "a made-up tale is a lie, and being caught costs much trust",
        ),
    ),
}


def _tell(state: Mapping[str, Any], body: dict[str, Any], person: str) -> dict[str, Any]:
    ws = state["world"]
    section, lo = ws["player"], lore()
    how = body["how"]
    blockers: list[Words] = []
    reasons: list[dict[str, Any]] = []
    entry = None
    if how == "fabricate":
        prop = speak.fabricated(lo, body)
        if prop is None:
            blockers.append(_blocker("bad_claim", person))
    else:
        entry = notebook.find(section, body["entry"])
        prop = None if entry is None else notebook.view(ws["social"])[entry["prop"]]
        if entry is None:
            blockers.append(_blocker("no_entry", person))
        elif how == "sharpen" and not offers.sharpenable(prop):
            blockers.append(_blocker("no_sharpen", person))
    saw = entry is not None and notebook.belief_of(entry).source == "saw"
    for sign, zh, en in TELLING.get(how, ()):
        if not (how == "as_seen" and saw and sign < 0):  # what the manager saw is no lie
            reasons.append(_reason(sign, zh, en, person))
    if prop is not None and speak.blames(lo, prop, person):
        reasons.append(
            _reason(
                -1,
                "这话说的是{n}家的不是，{n}听了会不高兴",
                "you speak ill of {n} or {n}'s own, and that will not go down well",
                person,
            )
        )
    if not _talking_to(ws, person):
        blockers.append(_blocker("not_talking", person))
    said = _w("这件事", "that") if prop is None else notebook.sentence(prop)
    asks = _quoted(_sentence("对{n}说「", "tell {n}: ", person), said, "」")
    return _out(state, "tell", asks, blockers=blockers, reasons=reasons)


# ---------------------------------------------------------------------------- asking for something


def _given(world: BridgeWorld, action: Mapping[str, Any]) -> Words | None:
    """What the page would have the manager give for a request: the words of its promise."""
    offer = action.get("offer")
    if not isinstance(offer, dict):
        return None
    what, item, amount = offer.get("what"), offer.get("item", ""), offer.get("amount", 0)
    if not isinstance(what, str) or not isinstance(item, str) or type(amount) is not int:
        return None
    return promise_text(world, what, item, amount, town=True)


def _score_reasons(person: str, weighed: persuade.Weighed) -> list[dict[str, Any]]:
    """The parts of the score that a person would own to, as reasons."""
    parts = dict(weighed.parts)
    reasons: list[dict[str, Any]] = []
    if parts["trust"] >= KNOWN_TRUST:
        reasons.append(_reason(1, "{n}已经有几分信你", "{n} already trusts you somewhat", person))
    else:
        reasons.append(_reason(-1, "{n}跟你还不熟", "{n} hardly knows you yet", person))
    if parts["favour"] > 0:
        reasons.append(_reason(1, "{n}欠你人情", "{n} owes you a favour", person))
    elif parts["favour"] < 0:
        reasons.append(_reason(-1, "你欠{n}人情", "you owe {n} a favour", person))
    if parts["hand"] > 0:
        reasons.append(
            _reason(1, "你许的东西，{n}记在心上", "what you promised {n} weighs with them", person)
        )
    if parts["crowd"] > 0:
        reasons.append(
            _reason(
                1,
                "{n}认识的人里，已经有人来帮工了",
                "some people {n} knows have joined already",
                person,
            )
        )
    if parts["personality"] <= -4:
        reasons.append(
            _reason(
                -1, "{n}做事小心，不容易被说动", "{n} is a careful sort, not easily moved", person
            )
        )
    elif parts["personality"] >= 4:
        reasons.append(
            _reason(1, "{n}为人厚道，好说话", "{n} is kind-hearted and easy to talk to", person)
        )
    return reasons


def _odds(weighed: persuade.Weighed, kind: str) -> str:
    over = weighed.total - weighed.need
    if kind == "join":
        return "high" if over >= entrust.JOIN_MARGIN else "mid" if over >= 0 else "low"
    if over >= ODDS_MARGIN:
        return "high"
    return "low" if over <= -ODDS_MARGIN else "mid"


def _testify_blocker(view: View, person: str) -> str | None:
    """Why none of what the person could testify to can be had now, whichever story is the true
    one (this looks at what the script gives them and not at what is real in the game)."""
    section = view.state["player"]
    items = [item for item in SCRIPT["evidence"] if item["acquire"]["from"] == person]
    if not items:
        return "nothing_to_say"
    unheld = [item for item in items if item["id"] not in section["evidence"]]
    if not unheld:
        return "said_already"
    why = [evidence.gate(view.world, section, item, view.now) for item in unheld]
    if all(found is not None for found in why):
        return next(reason for reason in ("closed", "refused", "needs") if reason in why)
    return None


def _entrust(
    world: BridgeWorld,
    state: Mapping[str, Any],
    body: dict[str, Any],
    person: str,
    action: Mapping[str, Any],
) -> dict[str, Any]:
    view = View(world, state)
    ws, section = view.state, view.state["player"]
    kind = body["kind"]
    gives = _given(world, action)
    if kind not in entrust.KINDS:
        return _out(
            state, "entrust", _w("一件事", "something"), gives, [_blocker("no_request", person)]
        )
    detail = ""
    if kind == "material":
        detail = goals_work.SUPPLIERS.get(person, ("",))[0]
    elif kind == "lend":
        detail = entrust.BAMBOO
    elif kind == "persuade":
        detail = body["target"]
    try:  # the words of the button of the talk, so that the card says what the button said
        asks = offers.request_label(person, body)
    except KeyError:  # a request that nobody could grant has no label
        name, what = _name(person), request_text(world, kind, detail)
        asks = _w(f"请{name['zh']}{what['zh']}", f"Ask {name['en']} {what['en']}")
    blockers: list[Words] = []
    if not _talking_to(ws, person):
        blockers.append(_blocker("not_talking", person))
    if kind == "testify":
        refusal = _testify_blocker(view, person)
    else:
        found = entrust.prepare(view, person, body)  # type: ignore[arg-type]
        refusal = found if isinstance(found, str) else None
    if refusal is not None:
        if refusal in objection.GAPS:  # Li Da: all that stands in the way, and not the first only
            blockers += [_blocker(code, person) for code in objection.gaps(ws)]
        elif refusal in entrust.STANDING:  # a promise of theirs is open, or no more is needed
            blockers.append(_standing_blocker(view, person))
        else:
            blockers.append(_blocker(refusal, person))
        return _out(state, "entrust", asks, gives, blockers)
    weighed, _, _, closed, sign = entrust.weigh_request(world, ws, person, kind, detail)
    waiting = any(
        row["npc"] == person and row["kind"] == kind and row["detail"] == detail
        for row in section["pending"]
    )
    reasons = _score_reasons(person, weighed)
    known = _tasks_blocked_for(world, ws, person)  # what the manager already knows is in the way
    if waiting or section["asked"].get(f"{person}|{kind}|{detail}") == sign:
        blockers += [*known, _blocker("said_already", person)]
        return _out(state, "entrust", asks, gives, blockers, None, reasons)
    if closed:
        blockers += known or [_blocker("closed_way", person)]
        return _out(state, "entrust", asks, gives, blockers, "low", reasons)
    if kind == "join" and 0 <= weighed.total - weighed.need < entrust.JOIN_MARGIN:
        reasons.append(
            _reason(
                -1,
                "{n}愿意，但想等熟人先来",
                "{n} is willing, but would rather wait for friends to go first",
                person,
            )
        )
    if kind == "material" and not blockers and commitments.promises_goods(world):
        arrival = _arrival(view, person)  # when the goods would come, if the person said yes
        if arrival is None:  # they would promise nothing: the answer is that they have said so
            return _out(
                state, "entrust", asks, gives, [_blocker("said_already", person)], None, reasons
            )
        asks = _then(asks, arrival)
    return _out(state, "entrust", asks, gives, blockers, _odds(weighed, kind), reasons)


def _promise(
    world: BridgeWorld, state: Mapping[str, Any], body: dict[str, Any], person: str
) -> dict[str, Any]:
    ws = state["world"]
    section = ws["player"]
    blockers: list[Words] = []
    reasons: list[dict[str, Any]] = []
    if not _talking_to(ws, person):
        blockers.append(_blocker("not_talking", person))
    if body["op"] == "keep":
        pledge = next((p for p in section["pledges"] if p["id"] == body["id"]), None)
        text = _w("兑现许诺", "Keep a promise")
        if pledge is not None:
            text = promise_text(world, pledge["what"], pledge["item"], pledge["amount"], town=True)
        if pledge is None:
            blockers.append(_blocker("no_pledge", person))
        elif pledge["to"] != person:
            blockers.append(_blocker("wrong_person", person))
        elif pledge["state"] != pledges.OPEN:
            code = "kept_already" if pledge["state"] == pledges.KEPT else "lapsed"
            blockers.append(_blocker(code, person))
        else:
            reasons.append(
                _reason(1, "兑现了，{n}会更信你", "keeping your word earns {n}'s trust", person)
            )
        return _out(state, "promise", text, text, blockers, None, reasons)
    what, item, amount = body["what"], body["item"], body["amount"]
    text = promise_text(world, what, item, amount, town=True)
    due = body["due"] or world.config["days"]
    if not pledges.holds(section, what, item, amount):
        blockers.append(_blocker("empty", person))
    elif not clock.at(state["tick"]).day <= due <= world.config["days"]:
        blockers.append(_blocker("bad_due", person))
    else:
        reasons.append(
            _reason(1, "许了，{n}会多信你一些", "a promise made earns {n}'s trust", person)
        )
        reasons.append(
            _reason(
                -1,
                "到期不兑现，{n}就不那么信你了",
                "a promise left unkept costs {n}'s trust",
                person,
            )
        )
    return _out(state, "promise", text, text, blockers, None, reasons)


# ---------------------------------------------------------------------------- the call


def preview(world: BridgeWorld, state: Mapping[str, Any], action: Any) -> dict[str, Any]:
    """The preview of an action, ``{"verb", "npc", ...}`` (see the docstring). ``state`` is the
    kernel's. An action that is not well formed is an ``InputError``."""
    where = "preview"
    if not isinstance(action, dict):
        raise InputError(f"{where}: the action must be an object")
    verb = action.get("verb")
    if verb not in VERBS:
        raise InputError(f"{where}: verb must be one of {', '.join(VERBS)}")
    person = converse.id_field(action.get("npc"), where, "npc")
    if person not in lore().index:
        raise InputError(f"{where}: {person!r} is not a person of the town")
    skip = (
        ("verb", "npc", "offer", "cite")
        if verb == "promise"
        else ("verb", "npc", "offer", "item", "cite")
    )
    fields = {k: v for k, v in action.items() if k not in skip}
    body = world.validate_player({"action_id": "preview", "type": verb, **fields})
    if verb == "ask":
        return _ask(state, body, person)
    if verb == "ask_source":
        return _ask_source(state, body, person)
    if verb == "tell":
        return _tell(state, body, person)
    if verb == "entrust":
        return _entrust(world, state, body, person, action)
    return _promise(world, state, body, person)
