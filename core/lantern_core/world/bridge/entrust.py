"""Entrusting: asking a person in a conversation to do something, and what they make of it.

``entrust`` is ``{"kind": kind, "target": id, "cite": [entry ids]}``, and the kinds are:

``material``  the man who has it brings the bamboo (Li Da) or the timber (Shopkeeper Zhou) to the
              bridge (``goals.agree_material``). Li Da will not be asked until his mother no
              longer objects, he knows of the clarification himself and he trusts the manager
              (``objection.gate``): "my mother has to agree first", "has it been cleared?".
``lane``      the temple keeper opens the lane behind the temple (``goals.agree_lane``).
``testify``   the person tells what they saw. Every item of evidence the script gives them that
              is real in this game and not yet held goes into the manager's hands, and the props
              it supports into the notebook as seen by the person and heard from them. The gates
              of the script apply (the hours of the day, what must be in hand first, how far the
              person who keeps the item trusts the manager), as for a ``look``.
``lend``      Granny Li lends the bamboo. Her hard condition has three ways (``persuade``). With
              one open and her score reached, she nods. That does not send Li Da: it is his bamboo,
              and he has to be asked himself (``material``).
``join``      the person joins the helpers (``goals.join``) if the score is ``JOIN_MARGIN`` over
              the price, and otherwise waits for one acquaintance fewer
              (``goals.lower_threshold``).
``persuade``  the person talks ``target``, whom they know, round: the target joins if they trust
              the person as far as ``JOIN_REACH`` (ten more for kin), and waits for one
              acquaintance fewer otherwise. Granny Li asked this way by the elder is her third way
              to the bamboo.
``convene``   the elder calls the clan to the hall before 17:00 (``assembly.convene``), for a
              reason: the manager holds some evidence (else ``needs``), and the elder weighs the
              request like any other, at a price of 30 (``persuade.NEED``) that the trust a talk a
              day earns and the helpers of the elder's acquaintance (``crowd``) come to, and a
              promise or a favour or a citation add to.

The person weighs the request with the hard condition and the score of ``persuade``. The reply is
an ``action_ack``, ``applied`` when they agree, and a line over their head (when every way of the
hard condition is shut, the line that says why, ``persuade.refusal``: Granny Li who knows the
rumour, and has heard nothing from the manager about it, names both). What the score and the
hard condition were is in the ``entrusted`` event. A person who is asked again the same thing when
none of the numbers has moved says they have said it already, and nothing changes; that holds for
a refusal and for a yes alike (``section["asked"]`` keeps the signature of each). For the goods
the promises they made count among those numbers (``commitments.round_mark``): once a promise is
kept, broken or taken back, and the bridge still lacks the item, the same request is a new question,
weighed again, and a yes promises the next batch. While a promise of theirs is open, or when the
bridge has all it needs of the item, the answer is a line that says so (``promise_open`` and
``goods_enough``, ``commitments.standing``), and the action is rejected as ``said_already``.

How a request is weighed, and the signature it is kept under, is ``weigh_request``; the answer, the
preview of it (``preview``) and the term ``turned_down`` of the tasks all read it. That term holds
while the last request of the manager was a no and asking again would only get "I have said it
already", so a task that waits on a person is blocked exactly as long as the preview says the same,
and any number that moves (a promise of the manager's, a friend who joined) opens it again.

A request that is granted is a favour the person did the manager: the deed ``asked:<key>`` goes
into the ledger of favours against the manager, once (``pledges``). Everyone who agrees to
anything but to testify is counted as won over (``section["won"]``).

Words. The manager may say something of their own with a request (the field ``words``, up to 200
characters). The rules weigh the request first, as they always did, and then a model is asked, on
the cheap tier, how far those words move this person, from -10 to 10 (``replies.judge``,
``persuade.read_wording``). The answer to the request waits for it, so the action is not
acknowledged until the judgement has come or has failed; a judgement that is missing, malformed or
not an integer counts as nothing, and a number past the limit is held to it. The wording is added to
the score and the person agrees if the sum reaches the price, and the ``entrusted`` event then also
says ``wording``. A request without words, or one made where no model is asked, is decided at once
with nothing added, as before. If the talk ends while the judge is out, the action is
acknowledged as rejected, ``not_talking``, and the request is as if it had not been made.

Won by a lie. If the manager told the person, in the last ``TAINT_WINDOW`` ticks, a lie that they
took in and have not caught, the yes is kept *pending* for ``PENDING_TICKS`` ticks instead of
acted on. If the person comes to believe, before it is due, that the manager lied (they caught it,
or heard it from a neighbour), they withdraw it: nothing is done, and the deed is struck from the
ledger. Otherwise it is acted on when it falls due. Testimony is never pending, and a yes that is
waiting is not asked for again.

Events: ``entrusted`` (``npc``, ``request``, ``detail``, ``result``: agreed, refused, hard,
said_already, ``total``, ``need``, ``way``, ``pending``), ``entrust_done`` and
``entrust_withdrawn`` (for a pending one), ``testified`` (``npc``, ``items``, ``entries``) and
``convened``. Rejected: ``not_talking``, ``no_request``, ``no_entry``, ``cannot``,
``nothing_to_say``, ``said_already``, ``needs_nod``, ``unaware``, ``distrust``, ``too_late``,
``closed``, ``needs``, ``refused``, ``hard``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, NamedTuple

from lantern_core.cognition.beliefs import SELF_SEEN, Belief, Claim
from lantern_core.inputs import InputError
from lantern_core.world.bridge import (
    agenda_terms,
    assembly,
    bonds,
    commitments,
    context,
    converse,
    evidence,
    goals,
    goals_call,
    goals_work,
    lies,
    notebook,
    notes,
    objection,
    pace,
    persuade,
    phrases,
    pledges,
    prompts,
    replies,
    repute,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

KINDS = persuade.KINDS
DEED_SIZE = {
    "testify": 1,
    "join": 1,
    "lane": 2,
    "material": 2,
    "persuade": 1,
    "lend": 2,
    "convene": 2,
}
JOIN_MARGIN = 10
JOIN_REACH = 70
KIN_REACH = 10
SUPPLIER_NEED = 15  # what Li Da asks once his mother has nodded
LENDER, CARRIER, BAMBOO = "li_laotai", "li_da", "bamboo"
TAINT_WINDOW = 600
PENDING_TICKS = 240
WATCH_STRIDE = 10
# why a person said no, as ``said_no`` keeps it: the score fell short, a gate shut for want of trust
# (a testimony), else the reason the action was turned down for
SCORE_SHORT, TRUST_GATE = "short", "trust"


@dataclass(frozen=True, slots=True)
class Ask:
    """A request that passed the first look: the kind, whom, and what it is about."""

    kind: str
    person: str
    detail: str = ""

    @property
    def key(self) -> str:
        return f"{self.person}|{self.kind}|{self.detail}"


@dataclass(frozen=True, slots=True)
class Deal:
    """A request that the rules have weighed and that waits for the wording, and then the answer.

    ``items`` are the ids of the evidence a testimony hands over, ``key`` and ``sign`` the request
    and the situation it was weighed in (``persuade.signature``) and ``before`` what the person
    had been asked in that situation before, to put back if the request is undone.
    """

    ask: Ask
    weighed: persuade.Weighed
    way: str
    items: tuple[str, ...]
    cites: tuple[str, ...]
    key: str
    sign: str
    before: str | None

    def to_row(self) -> dict[str, Any]:
        """The deal as the canonical values the state keeps while a judge is out."""
        return {
            "kind": self.ask.kind,
            "person": self.ask.person,
            "detail": self.ask.detail,
            "total": self.weighed.total,
            "need": self.weighed.need,
            "parts": [[name, value] for name, value in self.weighed.parts],
            "way": self.way,
            "items": list(self.items),
            "cites": list(self.cites),
            "key": self.key,
            "sign": self.sign,
            "before": self.before,
        }

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Deal:
        parts = tuple((name, value) for name, value in row["parts"])
        return cls(
            Ask(row["kind"], row["person"], row["detail"]),
            persuade.Weighed(row["total"], row["need"], parts),
            row["way"],
            tuple(row["items"]),
            tuple(row["cites"]),
            row["key"],
            row["sign"],
            row["before"],
        )


# ---------------------------------------------------------------------------- what was turned down


def detail_of(person: str, body: dict[str, Any]) -> str:
    """What a request is about, as ``Ask`` keeps it: the item of the goods, the bamboo lent, the
    person to talk round, else nothing."""
    kind = body["kind"]
    if kind == "material":
        return goals_work.SUPPLIERS.get(person, ("",))[0]
    if kind == "lend":
        return BAMBOO
    if kind == "persuade":
        return str(body.get("target", ""))
    return ""


def key_of(person: str, kind: str, detail: str) -> str:
    """The key a request is kept under in ``asked`` and ``said_no``: ``person|kind|detail``."""
    return f"{person}|{kind}|{detail}"


def remember_no(section: dict[str, Any], key: str, day: int, why: str, sign: str = "") -> None:
    """Keep that a person said no to a request today, and why (``SCORE_SHORT``, ``TRUST_GATE``
    or the reason an action was turned down for), with the situation it was weighed in (``sign``,
    which has no citations) if it was. The row is ``[day, why, sign, number]``: the number counts
    the refusals that are kept, so that the newest has the greatest (a row from a game from before
    the number was kept has none, and counts as the oldest). ``context`` reads it; no rule does."""
    rows = section.setdefault("said_no", {})
    newest = max((row[3] if len(row) > 3 else 0 for row in rows.values()), default=0)
    rows[key] = [day, why, sign, newest + 1]


def forget_no(section: dict[str, Any], key: str) -> None:
    """A person said yes to a request: it was not turned down after all."""
    rows = section.get("said_no")
    if rows is not None and rows.pop(key, None) is not None and not rows:
        del section["said_no"]


# ---------------------------------------------------------------------------- validating


def validate(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action entrust"
    out = converse.plain(body, "entrust")
    for name in ("kind", "target"):
        value = body.get(name, "")
        if not isinstance(value, str) or len(value) > converse.MAX_ID_CHARS:
            raise InputError(f"{where}: {name} must be a string of at most 64 characters")
        out[name] = value
    cite = body.get("cite", [])
    if not isinstance(cite, list) or len(cite) > 8:
        raise InputError(f"{where}: cite must be a list of at most 8 entry ids")
    out["cite"] = [converse.id_field(entry, where, "cite") for entry in cite]
    return converse.with_words(out, body, where)


# ---------------------------------------------------------------------------- the first look


def testimony(person: str, variant: str) -> list[dict[str, Any]]:
    """The items the script gives ``person`` to testify to that are real in this game."""
    return [
        item
        for item in SCRIPT["evidence"]
        if item["acquire"]["from"] == person and variant in item["real_in"]
    ]


def has_a_reason(section: dict[str, Any]) -> bool:
    """Whether the manager has something to put before the clan: some evidence in hand."""
    return bool(section["evidence"])


def shut_to_the_manager(sim: Sim, person: str) -> str | None:
    """Why nothing the script gives ``person`` to tell can be had now, if so: ``closed``,
    ``refused`` or ``needs``, the first gate that shut. It looks at every item the script gives
    them, and not at those that are real in this game, so that the hour, the day, the trust and what
    must be in hand are the same answer in every story: a person who has nothing to tell in the
    story that is true and a person who has something both say "not now" at a time that is shut to
    the manager."""
    section = sim.state["player"]
    items = [
        item
        for item in SCRIPT["evidence"]
        if item["acquire"]["from"] == person and item["id"] not in section["evidence"]
    ]
    why = [evidence.gate(sim.world, section, item, sim.now) for item in items]
    if not items or any(found is None for found in why):
        return None
    return next(reason for reason in ("closed", "refused", "needs") if reason in why)


def prepare(sim: Sim, person: str, body: dict[str, Any]) -> Ask | str:
    """The request as an ``Ask``, or the reason it cannot be made to this person."""
    section = sim.state["player"]
    kind, layout = body["kind"], goals_call.lay(sim.world)
    if kind == "material":
        if person not in goals_work.SUPPLIERS:
            return "cannot"
        held = commitments.standing(sim.state, person)
        if held is not None:  # a promise of theirs is open, or the bridge has all of it
            return held[0]
        why = objection.gate(sim.state) if person == CARRIER else None
        if why is not None:
            return why
        return Ask(kind, person, goals_work.SUPPLIERS[person][0])
    if kind == "lane":
        return Ask(kind, person) if person == goals_work.KEEPER else "cannot"
    if kind == "testify":
        shut = shut_to_the_manager(sim, person)  # before the person says if they saw anything
        if shut is not None:
            return shut
        real = testimony(person, sim.state["social"]["variant"])
        if not real:
            return "nothing_to_say"
        if all(item["id"] in section["evidence"] for item in real):
            return "said_already"
        return Ask(kind, person)
    if kind == "lend":
        if person != LENDER:
            return "cannot"
        return "said_already" if BAMBOO in section["nod"] else Ask(kind, person, BAMBOO)
    if kind in ("join", "persuade"):
        joined = goals.joined(sim.state)
        if person not in layout.helpers:
            return "cannot"
        if kind == "join":
            return "said_already" if person in joined else Ask(kind, person)
        target = body["target"]
        if target not in layout.helpers or target == person or target in joined:
            return "cannot"
        if target not in layout.knows.get(person, ()):
            return "cannot"
        return Ask(kind, person, target)
    if kind == "convene":
        if person != assembly.ELDER:
            return "cannot"
        why = assembly.can_convene(sim)
        if why is not None:
            return "said_already" if why == "already_called" else why
        if not has_a_reason(section):  # the elder calls the clan for a reason
            return "needs"
        return Ask(kind, person)
    return "no_request"


def opens_later(person: str) -> bool:
    """Whether something the person can testify to opens on a day of its own (``since`` in the
    script's table of opportunities)."""
    return any(
        item["acquire"].get("since") is not None
        for item in SCRIPT["evidence"]
        if item["acquire"]["from"] == person
    )


def situation(world_state: dict[str, Any], person: str, kind: str, closed: bool) -> str:
    """What is added to the signature of a request besides the score: that the way is closed, for
    the goods the promises the person has made so far and the state of the last, and for what a
    person has to tell that opens on a day of its own the day, so that a request put on a later
    day is a new question and not "I have said it already"."""
    mark = commitments.round_mark(world_state, person) if kind == "material" else ""
    day = ""
    if kind == "testify" and opens_later(person):
        day = f"day{world_state.get('weather', {}).get('day', 0)}"
    if kind == "convene" and world_state["player"]["meeting"]:  # a yes opens the hall: a new round
        mark = f"called{world_state['player']['meeting']['tick']}"
    return "|".join(part for part in ("closed" if closed else "", mark, day) if part)


class Weighing(NamedTuple):
    """A request as it is weighed: the score, the hard condition it meets (``hard_id``) and the way
    that is open to it, whether every way is shut, and the signature the answer is kept under."""

    weighed: persuade.Weighed
    hard_id: str | None
    way: str | None
    closed: bool
    sign: str


def weigh_request(
    world: BridgeWorld,
    world_state: dict[str, Any],
    person: str,
    kind: str,
    detail: str,
    cites: tuple[str, ...] = (),
) -> Weighing:
    """How ``person`` would weigh a request of this kind about ``detail`` now, and the signature of
    the situation it is weighed in. The answer to the request, the preview of it and the card of
    the task that waits on it all read this one."""
    need = SUPPLIER_NEED if kind == "material" and person == CARRIER else None
    weighed = persuade.weigh(world, world_state, person, kind, cites, need)
    hard_id = persuade.HARD.get((kind, detail))
    way = persuade.open_way(world_state, hard_id) if hard_id else None
    closed = hard_id is not None and way is None
    sign = persuade.signature(weighed, way, cites, situation(world_state, person, kind, closed))
    return Weighing(weighed, hard_id, way, closed, sign)


def answer_standing(sim: Sim, body: dict[str, Any], person: str) -> None:
    """Answer a request for goods that ``prepare`` turned away as ``promised`` or ``enough``: the
    person says which, with the numbers, and the action is rejected as ``said_already``."""
    held = commitments.standing(sim.state, person)
    assert held is not None
    row = held[1]
    if row is not None:
        converse.reply_goods(sim, commitments.PROMISE_OPEN, row["id"])
    else:
        converse.reply_goods(sim, commitments.GOODS_ENOUGH, goals_work.SUPPLIERS[person][0])
    converse.ack(sim, body, "said_already")


def _gates(sim: Sim, ask: Ask) -> tuple[str | None, list[dict[str, Any]]]:
    """For a testimony, the reason none of it can be had now (``closed``, ``refused`` or
    ``needs``), and the items that can be had."""
    section, world = sim.state["player"], sim.world
    open_items: list[dict[str, Any]] = []
    why: list[str] = []
    for item in testimony(ask.person, sim.state["social"]["variant"]):
        if item["id"] in section["evidence"]:
            continue
        blocked = evidence.gate(world, section, item, sim.now)
        if blocked is None:
            open_items.append(item)
        else:
            why.append(blocked)
    reason = next((r for r in ("closed", "refused", "needs") if r in why), None)
    return (None if open_items else reason), open_items


# ---------------------------------------------------------------------------- doing it


def _testify(sim: Sim, ask: Ask, items: list[dict[str, Any]]) -> None:
    """Hand over what the person saw: the items, and the props they support as heard from them.

    What the person says is a claim of theirs to the manager, kept as an answer is (``p1``...), so
    that the way back from the entry ends at them, where they say they saw it.
    """
    section, tick = sim.state["player"], sim.ctx.tick
    written: list[str] = []
    for item in items:
        section["evidence"].append(item["id"])
        for prop_id in item["supports"]:
            if notebook.by_prop(section, prop_id) is not None:
                continue
            said = Claim(
                "_", ask.person, (notebook.PLAYER_ID,), prop_id, "assert", SELF_SEEN, tick, "belief"
            )
            belief = Belief(
                notebook.PLAYER_ID,
                prop_id,
                "assert",
                notebook.heard_confidence(1, "assert"),
                "heard",
                ask.person,
                SELF_SEEN,
                1,
                tick,
                notebook.add_answer(section, said),
            )
            entry, _ = notebook.add_heard(section, belief)
            written.append(entry["id"])
    sim.emit("testified", npc=ask.person, items=[item["id"] for item in items], entries=written)


def _persuade(sim: Sim, person: str, target: str) -> bool:
    """``person`` speaks to ``target``: they join if they trust ``person`` enough, else wait for
    one acquaintance fewer."""
    lo, social = lore(), sim.state["social"]
    reach = bonds.value(social, lo, target, person, bonds.TRUST)
    if lo.family[target] is not None and lo.family[target] == lo.family[person]:
        reach += KIN_REACH
    if reach >= JOIN_REACH:
        return goals.join(sim, target)
    return goals.lower_threshold(sim, target, 1) >= 0


def commit(sim: Sim, ask: Ask, strong: bool) -> str | None:
    """Do what was agreed. None if it was done, else the reason it came to nothing."""
    section, tick = sim.state["player"], sim.ctx.tick
    if ask.kind == "material":
        return None if goals.agree_material(sim, ask.person) else "said_already"
    if ask.kind == "lane":
        return None if goals.agree_lane(sim, ask.person) else "said_already"
    if ask.kind == "lend":
        section["nod"][BAMBOO] = tick
        return None
    if ask.kind == "join":
        ok = goals.join(sim, ask.person) if strong else goals.lower_threshold(sim, ask.person) >= 0
        return None if ok else "cannot"
    if ask.kind == "persuade":
        if not _persuade(sim, ask.person, ask.detail):
            return "cannot"
        section["asks"].append([ask.person, ask.detail, tick])
        return None
    if ask.kind == "convene":
        return None if assembly.convene(sim) else "cannot"
    return "no_request"


def tainted(sim: Sim, person: str) -> list[str]:
    """The lies the manager told ``person`` lately that they took in and have not caught."""
    section, social, tick = sim.state["player"], sim.state["social"], sim.ctx.tick
    found: list[str] = []
    for row in lies.uncaught_to(section, person):
        note = social["beliefs"][person].get(row[2])
        if tick - row[4] <= TAINT_WINDOW and note is not None and notes.confidence_of(note) > 0:
            found.append(row[0])
    return found


def _thanks(kind: str) -> str:
    return {"persuade": "will_ask", "convene": "will_call", "testify": "testified"}.get(
        kind, "will_do"
    )


# why a request for goods is turned away before it is weighed (``commitments.standing``)
STANDING = (commitments.OPEN, commitments.ENOUGH)

# what a person says when the request cannot be made to them, by the reason
SAYS = {
    "nothing_to_say": "nothing_to_say",
    "said_already": "said_already",
    "needs_nod": "needs_nod",
    "needs": "turned_down",
    "closed": "closed",
    "refused": "turned_down",
    "too_late": "too_late",
    "unaware": "hard_hc_li_bamboo",  # Li Da has not heard that it was cleared
    "distrust": "turned_down",
}


def apply(sim: Sim, body: dict[str, Any]) -> None:
    section, lo = sim.state["player"], lore()
    found = converse.partner(sim)
    if found is None:
        return converse.ack(sim, body, "not_talking")
    person = lo.people[found[0]]
    if body["kind"] not in KINDS:
        return converse.ack(sim, body, "no_request")
    cites = tuple(dict.fromkeys(body["cite"]))[: persuade.CITE_MAX]
    if any(notebook.find(section, entry) is None for entry in cites):
        return converse.ack(sim, body, "no_entry")
    ask = prepare(sim, person, body)
    if isinstance(ask, str):
        if ask in STANDING:
            return answer_standing(sim, body, person)
        if ask not in ("said_already", "cannot"):
            asked = key_of(person, body["kind"], detail_of(person, body))
            remember_no(section, asked, sim.now.day, ask)
        converse.reply(sim, SAYS.get(ask, "cannot"))
        return converse.ack(sim, body, ask)
    items: list[dict[str, Any]] = []
    if ask.kind == "testify":
        blocked, items = _gates(sim, ask)
        if blocked is not None:
            trust = repute.trust(section, lo.index[person])
            remember_no(
                section,
                ask.key,
                sim.now.day,
                TRUST_GATE if blocked == "refused" else blocked,
                f"t{trust}" if blocked == "refused" else "",
            )
            converse.reply(sim, "closed" if blocked == "closed" else "turned_down")
            return converse.ack(sim, body, blocked)
    weighed, hard_id, way, closed, sign = weigh_request(
        sim.world, sim.state, person, ask.kind, ask.detail, cites
    )
    fields = {
        "npc": person,
        "request": ask.kind,
        "detail": ask.detail,
        "total": weighed.total,
        "need": weighed.need,
        "way": way or "",
    }
    waiting = any(
        row["npc"] == person and row["kind"] == ask.kind and row["detail"] == ask.detail
        for row in section["pending"]
    )
    if waiting or section["asked"].get(ask.key) == sign:
        converse.reply(sim, "said_already")
        sim.emit("entrusted", result="said_already", pending=False, **fields)
        return converse.ack(sim, body, "said_already")
    before = section["asked"].get(ask.key)
    section["asked"][ask.key] = sign
    if closed:
        remember_no(section, ask.key, sim.now.day, "hard")
        code = persuade.refusal(sim.state, hard_id)
        converse.reply(sim, code if code in phrases.PHRASES else "hard_other")
        sim.emit("entrusted", result="hard", pending=False, **fields)
        return converse.ack(sim, body, "hard")
    deal = Deal(
        ask,
        weighed,
        way or "",
        tuple(item["id"] for item in items),
        cites,
        ask.key,
        sign,
        before,
    )
    request = prompts.request_text(sim.world, ask.kind, ask.detail)
    if replies.judge(sim, body, deal.to_row(), request, body.get("words", "")):
        return  # the answer waits for the judgement of the words (see ``resume``)
    finish(sim, body, deal, 0, judged=False)


def finish(sim: Sim, body: dict[str, Any], deal: Deal, wording: int, judged: bool) -> None:
    """The person's answer to a request the rules have weighed, with the ``wording`` the judge
    gave the manager's words added to the score if there was a judge."""
    section, tick = sim.state["player"], sim.ctx.tick
    ask, person = deal.ask, deal.ask.person
    weighed = persuade.with_wording(deal.weighed, wording) if judged else deal.weighed
    fields: dict[str, Any] = {
        "npc": person,
        "request": ask.kind,
        "detail": ask.detail,
        "total": weighed.total,
        "need": weighed.need,
        "way": deal.way,
    }
    if judged:
        fields["wording"] = dict(weighed.parts)["wording"]
    if not weighed.agrees:
        short = weigh_request(sim.world, sim.state, person, ask.kind, ask.detail).sign
        remember_no(section, ask.key, sim.now.day, SCORE_SHORT, short)
        context.note_ask(sim.world, sim.state, person, ask.kind, ask.detail, sim.now.day, tick)
        converse.reply(sim, "turned_down")
        sim.emit("entrusted", result="refused", pending=False, **fields)
        return converse.ack(sim, body, "refused")
    strong = weighed.total >= weighed.need + JOIN_MARGIN
    via = [] if ask.kind == "testify" else tainted(sim, person)
    if not via:
        if ask.kind == "testify":
            wanted = set(deal.items)
            _testify(sim, ask, [item for item in SCRIPT["evidence"] if item["id"] in wanted])
        else:
            failed = commit(sim, ask, strong)
            if failed is not None:
                remember_no(section, ask.key, sim.now.day, failed)
                converse.reply(sim, SAYS.get(failed, "cannot"))
                sim.emit("entrusted", result=failed, pending=False, **fields)
                return converse.ack(sim, body, failed)
            if person not in section["won"]:
                section["won"].append(person)
    else:
        section["rseq"] += 1
        row = {"id": section["rseq"], "npc": person, "kind": ask.kind, "detail": ask.detail}
        row |= {"strong": strong, "due": tick + PENDING_TICKS, "via": via}
        section["pending"].append(row)
    forget_no(section, ask.key)
    pledges.add_deed(section, f"asked:{ask.key}", person, DEED_SIZE[ask.kind], -1, tick)
    batch = commitments.thanks(sim) if ask.kind == "material" and not via else ""
    converse.reply(sim, batch or _thanks(ask.kind))
    sim.emit("entrusted", result="agreed", pending=bool(via), **fields)
    converse.ack(sim, body)


def resume(sim: Sim, row: dict[str, Any], wording: int, judged: bool) -> None:
    """Go on with a request that waited for the judge (``row`` is its row in ``speech``)."""
    body = row["body"]
    mark = len(sim.ctx.events)
    since = pace.mark(sim)
    sim.act_seconds = pace.minutes("entrust") * 60  # what is made in it is made when it is over
    try:
        finish(sim, body, Deal.from_row(row["deal"]), wording, judged)
    finally:
        sim.act_seconds = 0
    pace.charge(sim, "entrust", since)  # the act was done now, not when it was asked
    replies.after(sim, body, mark)


def abandon(sim: Sim, row: dict[str, Any]) -> None:
    """Undo a request that waited for the judge when the talk ended: it was never answered, so
    asking again is not asking twice, and the action is acknowledged as having no talk to be in."""
    section = sim.state["player"]
    deal = Deal.from_row(row["deal"])
    if section["asked"].get(deal.key) == deal.sign:
        if deal.before is None:
            del section["asked"][deal.key]
        else:
            section["asked"][deal.key] = deal.before
    converse.ack(sim, row["body"], "not_talking")


# ---------------------------------------------------------------------------- the card's question


def _turned_down_records(cond: dict[str, Any]) -> dict[str, set[str]]:
    """A refused look is kept with the numbers it was refused at (``look_turned_down``)."""
    if cond.get("request") == "look":
        return {"look_refused": {"npc", "pledges", "talked"}}
    return {}


@agenda_terms.term("turned_down", {"npc": "person", "request?": "request"}, _turned_down_records)
def _turned_down(env: agenda_terms.Env, cond: dict[str, Any]) -> bool:
    """``turned_down``: the last time the manager asked ``npc`` for the goods they bring (or, with
    ``request: lane``, for the lane, and with ``request: testify``, for what they saw) the answer
    was no, and asking again would only be answered with "I have said it already": none of the
    numbers of the score has moved since, and neither have the promises of the person. It is the
    blocker that the preview of the same request gives (``preview``), so the card and the preview
    say one thing, and anything that moves a number (a promise, a favour, a friend who joined)
    opens the card again. A yes is not a no: it makes a promise, which moves the round on
    (``commitments.round_mark``), or sends the goods at once, or is waiting on a lie, or sets the
    keeper to work. With ``request: look`` it is the last look at a thing of ``npc`` that was
    refused (the event ``look_refused``), and it holds until the manager has promised them
    something or had a first talk with them on a later day, which are what move their trust."""
    person, kind, state = cond["npc"], cond.get("request", "material"), env.state
    goals_state = state["goals"]
    if kind == "look":
        return look_turned_down(state, person)
    if kind == "testify":
        detail = ""
    elif kind == "material":
        supplier = goals_work.SUPPLIERS.get(person)
        if supplier is None or goals_state.get("supply", {}).get(supplier[0]):
            return False
        detail = supplier[0]
    elif kind == "lane" and person == goals_work.KEEPER:
        if goals_state.get("lane", {}).get("task") or goals_work.LANE_OPENED in goals_state.get(
            "flags", {}
        ):
            return False
        detail = ""
    elif kind == "convene" and person == assembly.ELDER:
        detail = ""
    else:
        return False
    section = state["player"]
    sign = section["asked"].get(Ask(kind, person, detail).key)
    if sign is None or any(
        row["npc"] == person and row["kind"] == kind and row["detail"] == detail
        for row in section["pending"]
    ):
        return False
    return sign == weigh_request(env.world, state, person, kind, detail).sign


def look_turned_down(world_state: dict[str, Any], person: str) -> bool:
    """The last look at a thing of ``person`` was refused, and since then the manager has neither
    promised them anything nor had a first talk with them on a later day. The section ``agenda``
    keeps those two numbers with each ``look_refused`` it saw."""
    from lantern_core.world.bridge import agenda  # not at the top: agenda reads this module

    rows = [
        fields
        for kind, _, fields in world_state[agenda.SECTION]["seen"]
        if kind == agenda.LOOK_REFUSED and fields.get("npc") == person and "pledges" in fields
    ]
    if not rows:
        return False
    last = rows[-1]
    index = lore().index[person]
    return (
        last["pledges"] == agenda.promised_to(world_state, person)
        and last["talked"] == world_state["player"]["talked"][index]
    )


# ---------------------------------------------------------------------------- what is pending


def watch(sim: Sim) -> None:
    """Act on the yes that fell due, and let go of the ones whose person knows better now."""
    section, social, tick = sim.state["player"], sim.state["social"], sim.ctx.tick
    if tick % WATCH_STRIDE or not section["pending"]:
        return
    for row in list(section["pending"]):
        person = row["npc"]
        key = f"{person}|{row['kind']}|{row['detail']}"
        if repute.believes(social, person, repute.LIED):
            section["pending"].remove(row)
            section["deeds"].pop(f"asked:{key}", None)
            sim.emit("entrust_withdrawn", npc=person, request=row["kind"], detail=row["detail"])
        elif tick >= row["due"]:
            section["pending"].remove(row)
            ask = Ask(row["kind"], person, row["detail"])
            failed = commit(sim, ask, row["strong"])
            if failed is None and person not in section["won"]:
                section["won"].append(person)
            sim.emit(
                "entrust_done",
                npc=person,
                request=row["kind"],
                detail=row["detail"],
                result="done" if failed is None else failed,
            )
