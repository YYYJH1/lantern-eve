"""Why an act of the manager is not available now: the key ``hud.verbs_off`` of the frame.

``hud.verbs`` lists the acts the manager can do now. ``hud.verbs_off`` is ``{verb: reason}`` for
every act of ``player.VERB_ORDER`` and ``gift`` that is not on that list, so that a page can show
the button grey and say why. The reasons are a closed list, ``REASONS``:

``talking``      the manager is in a conversation, which the walking, the looking, the listening,
                 the call for helpers and speaking in public wait for
``busy``         the manager is looking at something, which takes the time it takes
``not_talking``  the act is a part of a conversation and the manager is in none: leaving, asking,
                 telling, asking a favour, promising and giving a small thing
``far``          there is nobody within reach to talk to, nothing within reach that holds evidence
                 to look at, nothing being said within hearing to listen to, or the manager is not
                 at a place where they may speak in public
``night``        it is night: the people within reach are asleep, or the evening at the teahouse is
                 over
``not_yet``      it is not time, or the thing is not there yet: the people within reach are busy,
                 the evening has not come to the teahouse or the clan is not called to the hall,
                 there is no note yet that was heard (so nothing to trace), fewer than two notes to
                 compare, or no other task to follow
``done``         it is done: the call for helpers is out already (or the festival is over), and
                 there is no other task to follow
``gift_today``   the town's gift of the day is given (``gifts``)
``gift_full``    the person has taken two gifts

One act has one reason: the first that holds, in the order of the list above. The aliases
``askSource`` (of ``ask_source``) and ``speak_publicly`` (of ``speak``) have the reason of the act
they stand for, as they are listed together in ``hud.verbs``.
"""

from __future__ import annotations

from typing import Any

from lantern_core.world.bridge import assembly, clock, gifts, player

REASONS = (
    "talking",
    "busy",
    "not_talking",
    "far",
    "night",
    "not_yet",
    "done",
    "gift_today",
    "gift_full",
)
GIFT = "gift"
IN_TALK = ("leave", "ask", "ask_source", "askSource", "tell", "entrust", "promise", GIFT)
FREE = ("move", "talk", "rally", "speak", "speak_publicly", "listen", "look")


def _talk_reason(world_state: dict[str, Any], tick: int) -> str:
    """Why nobody can be talked to now, for a manager who is free to talk: nobody is within reach
    (``far``), all of those who are are asleep (``night``), or busy (``not_yet``)."""
    section, people = world_state["player"], world_state["npcs"]["list"]
    near = [
        (index, npc)
        for index, npc in enumerate(people)
        if player.distance(section, npc) <= player.TALK_RANGE
    ]
    if not near:
        return "far"
    reasons = {player.declines(world_state, tick, index, npc) for index, npc in near}
    return "night" if reasons == {"asleep"} else "not_yet"


def _speak_reason(world: Any, world_state: dict[str, Any], now: clock.Now) -> str:
    """Why the manager may not speak in public here: not at a place for it (``far``), the evening
    at the teahouse is over (``night``), or the evening or the call of the clan has not come."""
    _, why = assembly.venue(world, world_state, now)
    if why == "no_venue":
        return "far"
    if why == "not_evening" and (now.phase == clock.NIGHT or now.hour >= assembly.EVENING[1]):
        return "night"
    return "not_yet"


def reason_for(
    verb: str, world: Any, world_state: dict[str, Any], tick: int, looks: list[str]
) -> str:
    """Why ``verb`` is not on the list of what the manager can do now. Call it for a verb that is
    not on it."""
    section, now = world_state["player"], clock.at(tick)
    talking = bool(section["talk"])
    if verb in IN_TALK:
        if not talking:
            return "not_talking"
        if verb == GIFT:
            return gifts.refusal(section, now.day, section["talk"]["npc"]) or "not_yet"
        return "not_yet"  # ask_source: nothing was heard yet, so there is no trail to follow
    if verb in FREE:
        if talking:
            return "talking"
        if section["busy"]:
            return "busy"
        if verb == "rally":
            return "done"
        if verb == "talk":
            return _talk_reason(world_state, tick)
        if verb in ("speak", "speak_publicly"):
            return _speak_reason(world, world_state, now)
        if verb == "listen":
            return "far"
        if verb == "look":
            return "far"
    if verb == "track":
        return "done"
    return "not_yet"  # judge and hint wait for two notes


def verbs_off(
    world: Any, world_state: dict[str, Any], tick: int, have: list[str], looks: list[str]
) -> dict[str, str]:
    """``{verb: reason}`` for the acts that ``have`` (``hud.verbs``) does not list."""
    listed = set(have)
    return {
        verb: reason_for(verb, world, world_state, tick, looks)
        for verb in player.VERB_ORDER
        if verb not in listed
    }
