"""What the actions of the festival manager share: answering them and putting words over a head.

An action is answered with an ``action_ack`` event, ``applied`` or ``rejected`` with a short
reason. What a person says back is kept in the section ``player`` as ``line``, a code and not
words (see ``player``), and the frame makes the words (``words``). The actions that happen inside
a conversation also need to know whom the manager is talking to.

When the person in the conversation has said the line that answers an action (an answer, a
refusal, an agreement), the call also has the signal ``replied`` (``npc``), so that a page that
is waiting for that line can stop waiting at once, even if the line is the one they said before.
A signal is not counted in the state (``Ctx.signal``). The line is made here (``reply``) or by
``player`` for an answer to a question, and the signal comes with it, before the event that says
what came of the action and before its ``action_ack``.

The actions that speak to a person may carry words of the manager's own, ``words``: a text of at
most ``MAX_WORDS`` characters, kept as plain text. It is data that a model reads (``prompts``),
and the rules never read it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.inputs import InputError
from lantern_core.world.bridge import notebook, phrases, voices
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.prompts import MAX_WORDS, tidy

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim

MAX_ID_CHARS = 64


def id_field(value: Any, where: str, name: str) -> str:
    """``value`` if it is a string of 1 to ``MAX_ID_CHARS`` characters, else ``InputError``."""
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_ID_CHARS:
        raise InputError(f"{where}: {name} must be a string of 1 to {MAX_ID_CHARS} characters")
    return value


def plain(body: dict[str, Any], kind: str) -> dict[str, Any]:
    """The start of a normalized body: the action id and the type."""
    return {"action_id": body["action_id"], "type": kind}


def ack(sim: Sim, body: dict[str, Any], reason: str | None = None) -> None:
    """Answer an action: ``applied`` when ``reason`` is None, else ``rejected`` for that reason."""
    result = "applied" if reason is None else "rejected"
    sim.emit("action_ack", action_id=body["action_id"], result=result, reason=reason)


def say(
    section: dict[str, Any], npc_id: str, until: int, kind: str, arg: str, lead: str = ""
) -> None:
    """Put the words of a person on show until the tick ``until``."""
    section["line"] = [npc_id, until, kind, arg, lead]


def partner(sim: Sim) -> tuple[int, dict[str, Any]] | None:
    """The cast index and the state of the person the manager is talking to, or None."""
    talk = sim.state["player"]["talk"]
    if not talk:
        return None
    index = sim.world.cast.index[talk["npc"]]
    return index, sim.state["npcs"]["list"][index]


def words_field(body: dict[str, Any], where: str) -> str:
    """The manager's words of an action, as plain text, or "" if it has none."""
    value = body.get("words", "")
    if not isinstance(value, str):
        raise InputError(f"{where}: words must be a text")
    text = tidy(value)
    if len(" ".join(value.split())) > MAX_WORDS:
        raise InputError(f"{where}: words must be at most {MAX_WORDS} characters")
    return text


def with_words(out: dict[str, Any], body: dict[str, Any], where: str) -> dict[str, Any]:
    """``out``, a normalized body, with the manager's words if the action has any."""
    text = words_field(body, where)
    if text:
        out["words"] = text
    return out


def words(world_state: dict[str, Any], line: list[Any], plain: bool = False) -> dict[str, str]:
    """The two texts of a line on show, in the voice of the person who says it (``voices``).

    A line is ``[npc, until, kind, arg, lead]``. A ``text`` is a code of ``phrases`` said as that
    person says it, and a ``point`` is a code of ``phrases.NAMED`` said so with the name of the
    person in ``lead`` (``pointers``). A ``goods`` is a code of ``phrases.GOODS`` said so with the
    slots filled from the promise whose number is in ``lead`` (``promise_open``) or from the item
    that is in it (``goods_enough``, see ``commitments.say_goods``). A ``claim`` is a claim kept as
    an answer (``arg`` is its id), said in the person's voice and opened by the phrase ``lead`` if
    there is one, and followed by the account somebody else told them if they said one with it
    (``notebook.twin_of``), a ``role`` is an entry (``lead``) of the list ``arg`` (``greet`` or
    ``chat``) of the person, which the state of the game chose (``roles``), and a
    ``said`` is a line a model wrote or the core made from the acts of a reply: ``arg`` is the
    Chinese and ``lead`` the English, as they passed the check. With ``plain`` a ``text``, a
    ``point`` and a ``claim`` are said in the plain words of the town and not in a voice of their
    own, which is what a prompt is made from, so that the state does not know there are voices
    (a ``role`` has no plain words of the town: it is the first variant of the entry).
    """
    npc, until, kind, arg, lead = line
    if kind == "text":
        return phrases.phrase(arg) if plain else voices.phrase(npc, arg, until)
    if kind == "point":  # a line that names the person it points to (``lead``)
        said = phrases.phrase(arg) if plain else voices.phrase(npc, arg, until)
        return phrases.named(said, lore().names[lead])
    if kind == "goods":  # a line of the goods: ``lead`` is the promise or the item it speaks of
        from lantern_core.world.bridge import commitments  # not at the top: it reads the voices

        said = phrases.phrase(arg) if plain else voices.phrase(npc, arg, until)
        return commitments.say_goods(world_state, said, arg, lead)
    if kind == "role":  # a line the person's lists choose by the state of the game (``roles``)
        from lantern_core.world.bridge import roles  # not at the top: it reads the voices

        return roles.words(npc, arg, lead, until, plain)
    if kind == "said":
        return {"zh": arg, "en": lead}
    section = world_state["player"]
    claim = notebook.answer(section, arg)
    lo = lore()
    prop = notebook.view(world_state["social"])[claim.prop]
    if plain:
        said = lo.lines.say(
            prop,
            lo.names,
            modality=claim.modality,
            claimed_source=claim.claimed_source,
            speaker=claim.speaker,
            pick=int(arg[1:]),
        )
        opener = phrases.phrase(lead) if lead else None
        out = phrases.joined(opener, said) if opener else dict(said)
        return _with_rival(world_state, out, arg, plain=True)
    said = voices.claim_words(
        prop, claim.modality, claim.claimed_source, claim.speaker, int(arg[1:]), claim.tick
    )
    out = phrases.joined(voices.phrase(npc, lead, claim.tick), said) if lead else dict(said)
    return _with_rival(world_state, out, arg, plain=False)


def _with_rival(
    world_state: dict[str, Any], said: dict[str, str], claim_id: str, plain: bool
) -> dict[str, str]:
    """``said``, the words of the answer ``claim_id``, followed by the account somebody else told
    the person, if they said one with it (``notebook.pair_rival``). With ``plain`` it is said in
    the plain words of the town and not in the voice of the person."""
    twin = notebook.twin_of(world_state["player"], claim_id)
    if twin is None:
        return said
    rival, lo = notebook.answer(world_state["player"], twin), lore()
    prop = notebook.view(world_state["social"])[rival.prop]
    if plain:
        tail = lo.lines.rival(prop, lo.names, teller=rival.claimed_source, speaker=rival.speaker)
    else:
        tail = voices.rival_words(prop, rival.claimed_source, rival.speaker, rival.tick)
    return phrases.joined(said, tail)


def replied(sim: Sim, npc_id: str) -> None:
    """Tell the host that ``npc_id``, who is in the conversation, has said the line that answers.
    The call counts it too (``Sim.replies``), for the rules, which may not read the signal."""
    sim.replies += 1
    sim.signal("replied", npc=npc_id)


def reply(sim: Sim, code: str) -> None:
    """The person in the conversation answers with a phrase (a code of ``phrases``) until the
    conversation is over."""
    section = sim.state["player"]
    talk = section["talk"]
    say(section, talk["npc"], talk["until"], "text", code)
    replied(sim, talk["npc"])


def reply_goods(sim: Sim, code: str, lead: str) -> None:
    """The person answers with a line of the goods (a code of ``phrases.GOODS``) about the promise
    ``lead`` or the item ``lead``, until the conversation is over."""
    section = sim.state["player"]
    talk = section["talk"]
    say(section, talk["npc"], talk["until"], "goods", code, lead)
    replied(sim, talk["npc"])
