"""Asking a model for what a townsperson says in a talk, and for how far the manager's words move
them (the asking side of ``speech``).

The rules answer first. Every action of the festival manager that a person answers (``ask``,
``ask_source``, ``tell``, ``entrust`` and ``promise``) is carried out by the rules of the town in
the call that applies it, the answer is written down and shown as ever, and the host is told
nothing it has to wait for. Then a request goes out to a model: the same answer in the person's
own words. When the result passes the gate (``speech.land``) the words replace the line on show
and what the person said is written down (``speech``). When the host answers with an error or a
timeout, the budget turns the request away, or the check fails twice, the answer of the rules
stays as it is, so a game with no model plays from the lines written for the townsfolk.

When to ask and which tier to ask are fixed rules and never the output of a model. A request goes
out for every answer in a talk whose tier (``tiers``, fixed when the talk opened) is not ``rule``.
It goes to that tier, in the category ``reply`` (the queue class of a reply the player waits for),
with a limit of ``REPLY_TOKENS`` of output, and it is good only while the talk it was asked in is
open (the condition ``talk_open``, which names the person and the tick the talk began at). While
a request for the person is in flight the frame says they are thinking (``thinking``).

The judge. When the manager says something of their own with a request (the field ``words``), the
person weighs the request by the rules as ever, and a second request goes out first, to the cheap
tier, for how far those words move them (``persuade.read_wording``). The answer to the request is
held until the judge has answered or failed, and then it is made with the wording added to the
score, or with nothing added. The action is not acknowledged before that, and if the talk ends
first it is acknowledged as ``not_talking`` and the request is forgotten, as if it had never been
made. A request that was judged once is not judged again, because the rules do not weigh it again
(``persuade.signature``).

The section ``speech`` keeps a row for every request in flight, by its interaction id::

    {"kind": "reply" | "judge", "npc": id, "start": tick the talk began, "verb": str,
     "sync": bool           the budget turned it away, so its result lands in this very call,
     "body"?, "deal"?       a judge: the action that waits, and what is being decided}

The interaction id is ``{verb}:{npc}:{n}`` for the n-th request of the game, and a repair of a
reply keeps it.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import answers, converse, notebook, prompts, speech, tiers
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim

CATEGORY = "reply"
REPLY, JUDGE = "reply", "judge"
REPLY_TOKENS = 400
JUDGE_TOKENS = 40
TALK_OPEN = "talk_open"
PLAYER = notebook.PLAYER_ID

Apply = Callable[["Sim", dict[str, Any]], None]


# ----------------------------------------------------------------------------- the requests


def talk_open_if(talk: dict[str, Any]) -> list[dict[str, Any]]:
    """The condition under which the result of a request is still good: this very talk is open."""
    return [{"op": TALK_OPEN, "npc": talk["npc"], "start": talk["start"]}]


def issue(
    sim: Sim,
    kind: str,
    verb: str,
    tier: str,
    messages: list[dict[str, str]],
    max_tokens: int,
    **extra: Any,
) -> None:
    """Put a request in flight for the person of the open talk, and keep a row for it."""
    talk = sim.state["player"]["talk"]
    mine = speech.section(sim.state)
    mine["turn"] += 1
    interaction = f"{verb}:{talk['npc']}:{mine['turn']}"
    request_id = sim.ctx.issue(
        interaction_id=interaction,
        tier=tier,
        category=CATEGORY,
        messages=messages,
        max_tokens=max_tokens,
        valid_if=talk_open_if(talk),
    )
    turned_away = any(record["request_id"] == request_id for record, _ in sim.ctx.templated)
    mine["pending"][interaction] = {
        "kind": kind,
        "npc": talk["npc"],
        "start": talk["start"],
        "verb": verb,
        "sync": turned_away,
        **extra,
    }


def thinking(world_state: dict[str, Any]) -> str | None:
    """The person of the open talk if a request for them is in flight, else None."""
    talk = world_state["player"]["talk"]
    if not talk:
        return None
    rows = world_state[speech.SECTION]["pending"]
    for interaction in sorted(rows):
        if rows[interaction]["npc"] == talk["npc"] and rows[interaction]["start"] == talk["start"]:
            return str(talk["npc"])
    return None


def talk_is_open(world_state: dict[str, Any], condition: dict[str, Any]) -> bool:
    """The condition ``talk_open``: the manager is in the talk with that person that began then."""
    talk = world_state["player"]["talk"]
    return bool(talk) and talk["npc"] == condition["npc"] and talk["start"] == condition["start"]


# ----------------------------------------------------------------------------- what was said


def _topic(world_state: dict[str, Any], topic: str) -> tuple[dict[str, str], tuple[str, ...]]:
    """What an ask is about in both languages, and the props it names (none for a subject)."""
    props = notebook.view(world_state["social"])
    if topic in props:
        return notebook.sentence(props[topic]), (topic,)
    return dict(lore().names.get(topic) or {"zh": topic, "en": topic}), ()


def _act(claim: Any) -> dict[str, str]:
    act = {
        "path": claim.path,
        "prop": claim.prop,
        "modality": claim.modality,
        "source": claim.claimed_source,
    }
    if claim.template_id:
        act["template"] = claim.template_id
    return act


def _line(world_state: dict[str, Any]) -> dict[str, str]:
    """The line on show in the plain words of the town: what the rules had the person say. It is
    not in the person's voice, which a model gets from the note on how they speak, so that the
    request, which the state keeps, does not depend on the voices."""
    return dict(converse.words(world_state, world_state["player"]["line"], plain=True))


def after_ask(
    sim: Sim, body: dict[str, Any], topic: str, purpose: str, said: answers.Reply
) -> None:
    """The person has answered a question by the rules: ask a model for the same in their words.

    ``topic`` is the prop or the entity asked about, or, for the question of who told them, the
    prop of the entry.
    """
    section = sim.state["player"]
    talk = section["talk"]
    text, props = _topic(sim.state, topic)
    pretend = said.kind == answers.IGNORANT and said.path == "ignorance"
    if said.kind == answers.CLAIM:
        outcome = "claim"
    elif said.kind == answers.EVASIVE:
        outcome = "evasive"
    else:
        outcome = "pretend" if pretend else "ignorant"
    act = None
    if said.claim is not None:
        act = _act(said.claim)
    elif pretend and said.template is not None:
        act = {"path": "lie", "template": said.template}
    verb = "ask_source" if purpose == answers.SOURCE else "ask"
    turn = prompts.Turn(
        verb,
        outcome,
        text,
        words=body.get("words", ""),
        topic_props=props,
        subjects=() if props else (topic,),
        act=act,
        line=_line(sim.state),
        rival=None if said.rival is None else _act(said.rival),
    )
    start(sim, talk, verb, turn)


def after(sim: Sim, body: dict[str, Any], mark: int) -> None:
    """An action by the manager has been carried out by the rules: if the person answered it,
    ask a model for their answer in words. ``mark`` is how many events the call had before."""
    section = sim.state["player"]
    talk = section["talk"]
    new = sim.ctx.events[mark:]
    if not talk or not any(event["kind"] == "replied" for event in new):
        return
    turn = _turn_of(sim, body, new)
    if turn is not None:
        start(sim, talk, turn.verb, turn)


def _turn_of(sim: Sim, body: dict[str, Any], new: list[dict[str, Any]]) -> prompts.Turn | None:
    kind = body["type"]
    words = body.get("words", "")
    line = _line(sim.state)
    ack = next((e for e in new if e["kind"] == "action_ack"), None)
    reason = ack["reason"] if ack is not None else None
    if kind == "tell":
        told = next((e for e in new if e["kind"] == "told" and e["speaker"] == PLAYER), None)
        if told is None:
            return None
        prop = notebook.view(sim.state["social"])[told["prop"]]
        return prompts.Turn(
            "tell",
            told["outcome"],
            notebook.sentence(prop),
            how=told["how"],
            words=words,
            topic_props=(prop.id,),
            line=line,
        )
    if kind == "entrust":
        made = next((e for e in new if e["kind"] == "entrusted"), None)
        outcome = _entrust_outcome(reason, made)
        what = body.get("target", "") or (made["detail"] if made is not None else "")
        text = prompts.request_text(sim.world, body["kind"], what)
        return prompts.Turn("entrust", outcome, text, words=words, subjects=_who(what), line=line)
    if kind == "promise":
        return _promise_turn(sim, body, new, line)
    return None


def _who(what: str) -> tuple[str, ...]:
    return (what,) if what in lore().names else ()


def _entrust_outcome(reason: str | None, made: dict[str, Any] | None) -> str:
    if reason is None:
        return "pending" if made is not None and made["pending"] else "agreed"
    return reason if reason in prompts.OUTCOMES else "refused"


def _promise_turn(
    sim: Sim, body: dict[str, Any], new: list[dict[str, Any]], line: dict[str, str]
) -> prompts.Turn | None:
    words = body.get("words", "")
    if body["op"] == "keep":
        kept = next((e for e in new if e["kind"] == "pledge_kept"), None)
        if kept is None:
            return None
        row = next(p for p in sim.state["player"]["pledges"] if p["id"] == kept["pledge"])
        what, item, amount, outcome = row["what"], row["item"], row["amount"], "kept"
    else:
        done = next((e for e in new if e["kind"] in ("pledged", "pledge_empty")), None)
        if done is None:
            return None
        what, item, amount = body["what"], body["item"], body["amount"]
        outcome = "deal" if done["kind"] == "pledged" else "empty"
    text = prompts.promise_text(sim.world, what, item, amount)
    return prompts.Turn("promise", outcome, text, words=words, line=line)


def start(sim: Sim, talk: dict[str, Any], verb: str, turn: prompts.Turn) -> None:
    """Ask for the reply of the person of the talk to ``turn``, unless the tier is the rules'."""
    tier = talk.get("tier", tiers.RULE)
    if tier == tiers.RULE:
        return
    messages = prompts.reply_messages(sim.world, sim.state, sim.ctx.tick, talk["npc"], turn)
    issue(sim, REPLY, verb, tier, messages, REPLY_TOKENS)


def answered(apply: Apply) -> Apply:
    """``apply``, an action of the manager that a person answers, followed by the request for
    their words once the rules have answered."""

    def run(sim: Sim, body: dict[str, Any]) -> None:
        mark = len(sim.ctx.events)
        apply(sim, body)
        after(sim, body, mark)

    return run


# ----------------------------------------------------------------------------- the judge


def judge(
    sim: Sim, body: dict[str, Any], deal: dict[str, Any], request: dict[str, str], words: str
) -> bool:
    """Ask a model how far the manager's ``words`` move the person to grant ``request``, and keep
    the action (``body``) and what is being decided (``deal``) until it has answered. Returns
    False, and asks nothing, when there are no words or the tier is the rules'."""
    talk = sim.state["player"]["talk"]
    if not words or talk.get("tier", tiers.RULE) == tiers.RULE:
        return False
    messages = prompts.judge_messages(sim.world, talk["npc"], request, words)
    speech.section(sim.state)["judge"]["asked"] += 1
    issue(sim, JUDGE, "judge", tiers.CHEAP, messages, JUDGE_TOKENS, body=body, deal=deal)
    return True


def release(sim: Sim) -> None:
    """The talk is over: forget every request that was asked in it. An action that waited for a
    judge is acknowledged as ``not_talking`` and undone (``entrust.abandon``)."""
    from lantern_core.world.bridge import entrust

    talk = sim.state["player"]["talk"]
    pending = sim.state[speech.SECTION]["pending"]
    for interaction in sorted(pending):
        row = pending[interaction]
        if row["npc"] != talk["npc"] or row["start"] != talk["start"]:
            continue
        del pending[interaction]
        if row["kind"] == JUDGE:
            entrust.abandon(sim, row)


def sweep(sim: Sim) -> None:
    """Forget a request that is no longer in flight and never landed (a result that was voided
    leaves nothing to say so), and finish an action that waited for a judge that is gone, with
    nothing added to the score."""
    from lantern_core.world.bridge import entrust

    pending = sim.state[speech.SECTION]["pending"]
    if not pending:
        return
    flying = {request["interaction_id"] for request in sim.ctx.state["requests"]}
    for interaction in sorted(pending):
        if interaction in flying:
            continue
        row = pending.pop(interaction)
        if row["kind"] != JUDGE:
            continue
        talk = sim.state["player"]["talk"]
        here = bool(talk) and (talk["npc"], talk["start"]) == (row["npc"], row["start"])
        if here:
            speech.section(sim.state)["judge"]["unscored"] += 1
            entrust.resume(sim, row, 0, judged=False)
        else:
            entrust.abandon(sim, row)
