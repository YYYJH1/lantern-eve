"""What a model says for a townsperson of the bridge town: the gate, a repair, a template, counts,
and the landing of a reply in the talk it was asked in.

``cognition.contract`` judges a reply and says nothing of the world. This module binds it to the
bridge town: the script and its words (``script``), the speaker as the game state has them
(``speaker_for``), what the story turns on (``plot_critical``), and what to do with the answer
(``land``). Whatever asks a model for a reply calls ``land`` when the result comes back. It is
also the subsystem that owns the section ``speech`` (``init``, ``tick``, ``frame``, ``RESULTS``
and ``CONDITIONS``): ``replies`` asks for the words of a person in a talk, and the result of the
request lands here (``on_result``) and is shown or set aside (``deliver``).

The flow of one reply
---------------------
A result lands for a request of the category ``reply`` or ``prefetch``. ``land`` is given the
request, the result, and who speaks to whom.

1. A result that is not ``ok`` (a timeout, an error, a request the budget turned away) has no text
   to judge. The core speaks a template line and nothing is repaired: whether to repair depends on
   what the check finds, and only on that.
2. Otherwise the text goes through ``contract.gate``. If it passes, the line is the reply.
3. If it fails and this was the first try, one repair goes out through ``Ctx.issue``: the same
   interaction, the same category, the same tier, the same ``max_tokens`` and the same conditions,
   with the messages of the request followed by the failed reply (as the model's own turn, which
   keeps the roles alternating for a chat template that insists on it) and the list of errors (see
   ``repair_messages``). Nothing is shown yet. Because the interaction is the same, whatever the
   caller keeps for it applies to the result of the repair as to the first. A request is a repair
   if its last message is the notice that begins with ``REPAIR_MARK``, so there is exactly one
   repair of a reply.
4. If the repair fails too, or its result is not ``ok`` (the budget may turn the repair away), the
   core speaks the template line: the speaker's own words for not knowing.

Only a line that passed, or the template, is ever in the ``Landed`` that comes back, so nothing a
model wrote reaches a frame before it has passed.

In a talk with the manager the rules have answered already (``replies``), and the line of the rules
is on show. A line that passed replaces it, and what the person said is written down as the rules
write down an answer: the claims as answers to the manager (``notebook.take_answer``), what the
manager hears of them in the notebook, and the line itself (a line of the kind ``said``, see
``converse.words``). Anything else (the template) leaves the answer of the rules where it is. In
both cases the person has said the line they will say, and the signal ``replied`` tells the host so,
unless the budget turned the request away in the very call of the action, when nothing was waiting.
The event ``answered`` (``npc``, ``verb``, ``result``: ``line`` or ``template``, ``by``: ``core``,
``model`` or ``template``, ``cause``: why a template, ``claims``: the ids of the answers written,
``entries``: the ids of the entries of the notebook they are in) says what came of it.

Counting
--------
``state["world"]["speech"]`` keeps the rates of the game::

    {"seq": int                    the number of results that were judged or templated,
     "lines": int                  the replies judged, first tries and repairs,
     "passed": int                 of those, the ones that passed,
     "by": {"core", "model"}       who wrote the lines that passed,
     "fixed": int                  the replies whose JSON needed a repair by the forgiving reader,
     "errors": {type: n}           the replies with an error of the type (``ERROR_TYPES``),
     "codes": {code: n}            the errors by code, such as the refusals of ``paths``,
     "paths": {path: n}            the acts refused at step 1, by the path they claimed,
     "repairs": int                repairs asked for,
     "mended": int                 the repairs that passed,
     "templates": {cause: n}       the lines the core spoke itself, by cause: ``check`` (the repair
                                   failed), ``timeout``, ``error``, or why the budget refused,
     "turn": int                   the number of requests asked in talks (``replies``),
     "pending": {interaction: row} the requests in flight, see ``replies``,
     "judge": {"asked", "scored", "unscored"}   the judgements of the manager's words asked for,
                                   the ones that gave a score and the ones that did not}

``rates`` turns the first of them into integers per thousand replies judged.
"""

from __future__ import annotations

import functools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from lantern_core.cognition import contract, paths
from lantern_core.cognition.beliefs import Claim
from lantern_core.cognition.lexicon import Lexicon
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import (
    bonds,
    converse,
    goals_ending,
    notebook,
    notes,
    retell,
    voices,
)
from lantern_core.world.bridge.lore import BLAME_PREDS, Lore, lore
from lantern_core.world.bridge.speech_data import SPEECH

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "speech"
CAUSAL_PREDS = (*BLAME_PREDS, "flood_damaged")  # acts that name a cause: who broke it, who took it
TEMPLATE_CODE = "unknown"  # the fixed line the core speaks: "I know nothing about that"
GUESS_MARK = "g"


# ----------------------------------------------------------------------------- the script


def plot_critical(lo: Lore, prop: Prop) -> bool:
    """Whether the story turns on ``prop``: it says who or what broke the thing the story opens
    with, or it cannot be true together with another prop of the script. The script does not mark
    its plot-critical props, so this reads them off what it does say."""
    if goals_ending.about_the_conflict(prop):
        return True
    return any(lo.excludes(prop, lo.book.props[pid]) for pid in lo.book.props)


@functools.cache
def script() -> contract.Script:
    """The bridge town's script as the gate reads it, built once per process."""
    lo = lore()
    return contract.Script(
        tables=lo.tables,
        registry=lo.book.registry,
        rules=lo.book.rules,
        templates=lo.book.templates,
        public=lo.public,
        names=lo.names,
        lexicon=Lexicon(SPEECH),
        critical=lambda prop: plot_critical(lo, prop),
        causal=CAUSAL_PREDS,
    )


# ----------------------------------------------------------------------------- the speaker


class BridgeVoice:
    """A townsperson's own words for what they say (``voices``) and for knowing nothing."""

    __slots__ = ("pick", "speaker", "tick")

    def __init__(self, speaker: str, tick: int, pick: int) -> None:
        self.speaker, self.tick, self.pick = speaker, tick, pick

    def claim(self, prop: Prop, modality: str, source: str) -> Mapping[str, str]:
        return voices.claim_words(prop, modality, source, self.speaker, self.pick, self.tick)

    def unknown(self) -> Mapping[str, str]:
        return voices.phrase(self.speaker, TEMPLATE_CODE, self.tick)


def _settle(lo: Lore, made: Mapping[str, Prop], draft: Prop) -> Prop:
    """The prop for a structured prop of a reply: what the script or the game has with the same
    content, or a new one. A mutation is named as the talk between neighbours names it
    (``retell.settle``). A guess has no parent: it is named for its predicate."""
    if draft.parent is not None:
        return retell.settle(lo, made, draft)
    for known in (lo.book.props, made):
        for pid in sorted(known):
            if known[pid].same_fact(draft):
                return known[pid]
    base = f"{draft.pred}__{GUESS_MARK}"
    number = 1
    while f"{base}{number}" in made or f"{base}{number}" in lo.book.props:
        number += 1
    return Prop(
        f"{base}{number}", draft.pred, draft.args, draft.span, draft.neg, draft.motive, None, None
    )


def speaker_for(
    world_state: Mapping[str, Any],
    speaker: str,
    listeners: Sequence[str],
    tick: int,
    pick: int = 0,
) -> contract.Speaker:
    """``speaker``, a person of the cast, as the game state has them at ``tick``, speaking to
    ``listeners``.

    ``pick`` chooses among the speaker's hedges when the core words a guess. ``world_state`` is
    ``state["world"]``.
    """
    lo = lore()
    social = world_state["social"]
    made = notes.made_props(social)
    return contract.Speaker(
        id=speaker,
        listeners=tuple(listeners),
        tick=tick,
        store=notes.store(social, speaker),
        book=notebook.view(social),
        suspicion=lo.traits[speaker]["suspicion"],
        relation=bonds.grudge_check(social, lo),
        guards=lambda prop: lo.guards(speaker, prop),
        settle=lambda draft: _settle(lo, made, draft),
        voice=BridgeVoice(speaker, tick, pick),
    )


# ----------------------------------------------------------------------------- the state


def fresh() -> dict[str, Any]:
    """The section as it starts: nothing judged, nothing counted, nothing in flight."""
    return {
        "seq": 0,
        "lines": 0,
        "passed": 0,
        "by": {},
        "fixed": 0,
        "errors": {},
        "codes": {},
        "paths": {},
        "repairs": 0,
        "mended": 0,
        "templates": {},
        "turn": 0,
        "pending": {},
        "judge": {"asked": 0, "scored": 0, "unscored": 0},
    }


def section(world_state: dict[str, Any]) -> dict[str, Any]:
    """The section of the game (a game has it from the start; a world made without the subsystem
    gets it when it is first needed). ``world_state`` is ``state["world"]``."""
    found = world_state.get(SECTION)
    if found is None:
        found = world_state[SECTION] = fresh()
    return found


def _bump(table: dict[str, int], key: str) -> None:
    table[key] = table.get(key, 0) + 1


def rates(world_state: Mapping[str, Any]) -> dict[str, int]:
    """What the game has counted, as integers per thousand, or nothing if no reply was judged.

    ``format``, ``path``, ``entity``, ``connective`` and ``private`` are the replies judged with an
    error of that type, per thousand replies judged. ``pass`` is the replies that passed, ``fixed``
    those whose JSON needed the forgiving reader and ``repair`` the repairs asked for, also per
    thousand judged. ``template`` is the lines the core spoke itself, per thousand replies that
    ended (a line that passed, or a template).
    """
    found = world_state.get(SECTION)
    if found is None or not found["lines"]:
        return {}
    judged = found["lines"]
    out = {kind: 1000 * found["errors"].get(kind, 0) // judged for kind in contract.ERROR_TYPES}
    out["pass"] = 1000 * found["passed"] // judged
    out["fixed"] = 1000 * found["fixed"] // judged
    out["repair"] = 1000 * found["repairs"] // judged
    templates = sum(found["templates"][cause] for cause in sorted(found["templates"]))
    ended = found["passed"] + templates
    out["template"] = 1000 * templates // ended if ended else 0
    return out


def _count(counts: dict[str, Any], gated: contract.Gated) -> None:
    counts["lines"] += 1
    if gated.fixes:
        counts["fixed"] += 1
    for kind in gated.types:
        _bump(counts["errors"], kind)
    for error in gated.errors:
        _bump(counts["codes"], f"{error.type}:{error.code}")
        if error.type == "path" and error.where.startswith("acts["):
            index = int(error.where[5:].split("]", 1)[0])
            if index < len(gated.paths):
                _bump(counts["paths"], gated.paths[index])
    if gated.ok:
        counts["passed"] += 1
        _bump(counts["by"], gated.by)


# ----------------------------------------------------------------------------- the repair

REPAIR_MARK = "[contract check]"
MAX_LISTED = 8  # errors named in the repair request
MAX_ECHO = 2000  # characters of the failed reply that the repair request repeats


def repair_messages(
    messages: Sequence[Mapping[str, str]], text: str, errors: Sequence[contract.Error]
) -> list[dict[str, str]]:
    """The messages of the repair request: those of the request, then the reply that failed (as
    the model's own turn), then the list of errors. The notice names ids and short quoted words
    only, so nothing the player or the model wrote reaches the model again as an instruction."""
    listing = "\n".join(f"- {error.text()}" for error in errors[:MAX_LISTED])
    notice = (
        f"{REPAIR_MARK} Your reply was refused for these reasons:\n{listing}\n"
        "Answer again with one corrected JSON object that follows the same contract, and nothing "
        "else. Change only what the reasons name."
    )
    return [
        *({"role": m["role"], "content": m["content"]} for m in messages),
        {"role": "assistant", "content": text[:MAX_ECHO]},
        {"role": "user", "content": notice},
    ]


def is_repair(request: Mapping[str, Any]) -> bool:
    """Whether ``request`` is a repair of a reply: its last message is the notice, after a turn of
    the model's. Only the core builds that shape, so nothing a player writes makes a first try pass
    for a repair, and a first try that does is at worst templated without its repair."""
    messages = request["messages"]
    return (
        len(messages) >= 2
        and messages[-2]["role"] == "assistant"
        and messages[-1]["role"] == "user"
        and messages[-1]["content"].startswith(REPAIR_MARK)
    )


# ----------------------------------------------------------------------------- landing a result

BUDGET_CAUSES = ("budget", "cloud_down", "local_down")  # why the budget gate turns a request away


@dataclass(frozen=True, slots=True)
class Landed:
    """What a result came to.

    ``kind`` is ``line`` (a reply passed: ``line`` is the words to show, ``by`` who wrote them,
    ``core`` or ``model``, and ``claims``, ``props`` and ``feigned`` what the world may write down
    for it, see ``contract.Gated``), ``template`` (the core spoke its fixed line in the speaker's
    voice: ``cause`` says why), ``repair`` (a repair was asked for, ``repair`` is its request id,
    and nothing is shown yet) or ``none`` (the request was cancelled). ``errors`` are the errors
    that led to a repair or a template.
    """

    kind: str
    line: Mapping[str, str] | None = None
    by: str = ""
    mood: str = "plain"
    address: str = "none"
    claims: tuple[Claim, ...] = ()
    props: tuple[Prop, ...] = ()
    feigned: tuple[str, ...] = ()
    errors: tuple[contract.Error, ...] = ()
    repair: str | None = None
    cause: str = ""


def _template(
    sim: Sim, counts: dict[str, Any], speaker: str, cause: str, errors: Sequence[contract.Error]
) -> Landed:
    counts["seq"] += 1
    _bump(counts["templates"], cause)
    line = voices.phrase(speaker, TEMPLATE_CODE, sim.ctx.tick)
    return Landed("template", line, "template", errors=tuple(errors), cause=cause)


def _cause(status: str, text: str) -> str:
    if status == "timeout":
        return "timeout"
    return text if text in BUDGET_CAUSES else "error"


def land(
    sim: Sim,
    request: Mapping[str, Any],
    status: str,
    text: str,
    *,
    speaker: str,
    listeners: Sequence[str],
) -> Landed:
    """Take in a result for a reply of ``speaker`` to ``listeners`` (see the module docstring).

    Call it from the handler of the results of the categories ``reply`` and ``prefetch``, once for
    every result. The world is given what to show or write down in the ``Landed`` that comes back.
    """
    counts = section(sim.state)
    if status == "cancelled":
        return Landed("none")
    if status != "ok":
        return _template(sim, counts, speaker, _cause(status, text), ())
    tick = sim.ctx.tick
    gated = contract.gate(
        text, speaker_for(sim.state, speaker, listeners, tick, counts["seq"]), script()
    )
    _count(counts, gated)
    repair = is_repair(request)
    if gated.ok:
        counts["seq"] += 1
        if repair:
            counts["mended"] += 1
        return Landed(
            "line",
            gated.line,
            gated.by,
            gated.mood,
            gated.address,
            gated.claims,
            gated.props,
            gated.feigned,
        )
    if repair:
        return _template(sim, counts, speaker, "check", gated.errors)
    counts["repairs"] += 1
    request_id = sim.ctx.issue(
        interaction_id=request["interaction_id"],
        tier=request["tier"],
        category=request["category"],
        messages=repair_messages(request["messages"], text, gated.errors),
        max_tokens=request["max_tokens"],
        valid_if=list(request["valid_if"]),
    )
    return Landed("repair", errors=gated.errors, repair=request_id)


# ----------------------------------------------------------------------------- the subsystem


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    """The section at the start of a game: nothing judged, nothing in flight."""
    return fresh()


def tick(sim: Sim) -> None:
    """Forget the requests that are gone (see ``replies.sweep``)."""
    from lantern_core.world.bridge import replies

    replies.sweep(sim)


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """Say in the ``player`` of the frame who is thinking: the person of the talk, while a request
    for their words is in flight (``replies.thinking``), else null."""
    from lantern_core.world.bridge import replies

    if "player" in out:
        out["player"]["thinking"] = replies.thinking(state["world"])


def talk_open(world: BridgeWorld, state: dict[str, Any], condition: dict[str, Any]) -> bool:
    """The ``valid_if`` condition ``talk_open`` (see ``replies.talk_is_open``)."""
    from lantern_core.world.bridge import replies

    return replies.talk_is_open(state["world"], condition)


def on_result(sim: Sim, request: dict[str, Any], status: str, text: str) -> None:
    """Take in the result of a request of ``replies``: a reply goes through the gate and is shown
    or set aside, and a judgement of the manager's words lets the action that waited go on."""
    pending = section(sim.state)["pending"]
    interaction = request["interaction_id"]
    row = pending.get(interaction)
    if row is None:
        return
    if row["kind"] == "judge":
        del pending[interaction]
        judged(sim, row, status, text)
        return
    landed = land(sim, request, status, text, speaker=row["npc"], listeners=[notebook.PLAYER_ID])
    if landed.kind == "repair":
        return  # the repair is the same interaction, and its result lands in this row
    del pending[interaction]
    if landed.kind != "none":
        deliver(sim, row, landed)


def deliver(sim: Sim, row: dict[str, Any], landed: Landed) -> None:
    """Show a line that passed and write down what the person said, or leave the answer of the
    rules where it is (see the module docstring)."""
    world_state = sim.state
    section_ = world_state["player"]
    talk = section_["talk"]
    npc = row["npc"]
    claims: list[str] = []
    entries: list[str] = []
    if landed.kind == "line":
        assert landed.line is not None
        social = world_state["social"]
        for prop in landed.props:
            social["props"].setdefault(prop.id, notes.encode_prop(prop))
        for claim in landed.claims:
            hold_conclusion(world_state, claim)
            claim_id, entry, _ = notebook.take_answer(world_state, npc, claim, reuse=True)
            claims.append(claim_id)
            entries.append(entry["id"])
        for claim_id in claims:  # an answer that said another account after it, and no longer does
            twin = notebook.twin_of(section_, claim_id)
            if twin is not None and twin not in claims:
                notebook.unpair_rival(section_, claim_id)
        converse.say(section_, npc, talk["until"], "said", landed.line["zh"], landed.line["en"])
    if row["sync"]:
        return  # asked and answered in the call of the action, which has said it all
    converse.replied(sim, npc)
    sim.emit(
        "answered",
        npc=npc,
        verb=row["verb"],
        result=landed.kind,
        by=landed.by,
        cause=landed.cause,
        claims=claims,
        entries=entries,
    )


def hold_conclusion(world_state: dict[str, Any], claim: Claim) -> None:
    """A person who says a guess, or a story changed from one they hold, comes to hold it
    themselves, as the talk between neighbours has it (``telling``)."""
    if claim.path not in ("speculation", "mutation"):
        return
    social = world_state["social"]
    if claim.prop in social["beliefs"][claim.speaker]:
        return
    own = paths.speaker_belief(
        claim,
        notes.store(social, claim.speaker),
        notebook.view(social),
        public=lore().public,
    )
    if own is not None:
        notes.hold(social, own)


def judged(sim: Sim, row: dict[str, Any], status: str, text: str) -> None:
    """The judgement of the manager's words came, or failed: the action that waited goes on, with
    the wording added to its score, or with nothing added."""
    from lantern_core.world.bridge import entrust, persuade

    score = persuade.read_wording(text) if status == "ok" else None
    counts = section(sim.state)["judge"]
    counts["scored" if score is not None else "unscored"] += 1
    entrust.resume(sim, row, score or 0, judged=score is not None)


RESULTS = {"reply": on_result, "prefetch": on_result}
CONDITIONS = {"talk_open": talk_open}
