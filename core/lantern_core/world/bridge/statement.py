"""The statement card: how the manager says what happened to the bridge, part by part.

The script (``statement`` in ``content/scripts/broken_bridge.yaml``) gives three parts, the cause of
the break, the course of that night and where the talk about Li Er came from. Each part has a closed
list of options, written once and the same in every variant of the story, so that a list gives
nothing away. The manager chooses one option in each part, and when they have filled the card they
make the full statement in public (``assembly``, the speech of the kind ``statement``).

*What the card shows.* An option is shown once the notebook holds a note that bears on it: a note
of one of the props the option ``supports`` bears for it, and a note of one of the props it is
``against`` bears against it. ``support`` and ``against`` count those notes, and ``entries`` names
them, in the order of the notebook. A note of what somebody only guesses (a belief of the modality
``speculate``, which people come to in the night, see ``reflection``) bears on nothing: what is
stated rests on what was seen and what was told as so. The card is made from the notebook and
the choices alone: it reads nothing of the variant that is true, so the same notes give the same
card in every story (``projection`` has the audit, and the tests change the hidden fields and
compare). A part that has no option shown yet is a ``gap``.

*Choosing.* The player action ``statement`` is ``{"op": "choose", "part", "option"}`` or
``{"op": "clear", "part"}``. It costs no time, it can be made in a talk and out of one, and it is
answered ``applied`` or ``rejected`` as ``unknown_part``, ``unknown_option`` or ``not_shown`` (the
option is in the list, but no note bears on it yet). The choices are kept in the section ``player``
as ``"statement": {part: option id}``, which a game has once the manager has chosen something.

*Judging.* The core judges a statement in three ways apart (``assembly``): whether each part is
right in the story that is true (``wrong_parts``), whether the evidence held is enough, and whether
the people there accept. For a part that is not right ``failure`` names the kind of failure
without giving the answer, from the notebook alone: the part is *contradicted* by what a witness,
or the manager, saw (the first note against it that was seen first-hand), or *unseen* (no note for
it was seen first-hand), or *unsourced* (what was seen is not what it says).

The frame key ``statement`` (``wire``)::

    {"parts": [{"part": "cause" | "course" | "rumour", "title": {"zh", "en"},
                "options": [{"id", "text": {"zh", "en"}, "support": int, "against": int,
                             "entries": [entry ids]}],
                "chosen": option id | null, "gap": bool}],
     "can_state": bool, "why_not": {"zh", "en"} | null, "used_today": bool,
     "last": {"day", "hour", "venue", "named", "accepted", "percent",
              "elder": "absent" | "refused" | "accepted", "told": bool, "wrong": [part],
              "why": {"zh", "en"} | null} | null}

``can_state`` says whether a full statement can be made here and now, and ``why_not`` why not (the
rejections of the speech have the same reasons). ``last`` is the last full statement: ``wrong`` the
parts that did not hold and ``why`` the words for what it fell short of, naming the kind of failure
of each part that did not hold, else that the proof was not enough, else the first condition of the
goal that it missed. ``board.statement`` is the summary of the parts (``summary``).

The agenda terms ``card_filled``, ``card_fillable`` and ``stated_today`` read the card (they are
registered in ``agenda_terms``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.cognition.beliefs import SELF_SEEN
from lantern_core.inputs import InputError
from lantern_core.world.bridge import clock, converse, notebook
from lantern_core.world.bridge.converse import ack
from lantern_core.world.bridge.data import SCRIPT

if TYPE_CHECKING:
    from lantern_core.world.bridge.world import BridgeWorld

SECTION_KEY = "statement"  # in the section ``player``: {part: option id}, once something is chosen
PARTS = ("cause", "course", "rumour")
CHOOSE, CLEAR = "choose", "clear"
# The trust each person there takes off the manager for a statement in which any part did not hold:
# once for the statement, however many of its parts failed.
STATEMENT_COST = 8

CONTRADICTED, UNSEEN, UNSOURCED = "contradicted", "unseen", "unsourced"
KINDS = (CONTRADICTED, UNSEEN, UNSOURCED)

# why a full statement cannot be made now (the reasons of the rejections of the speech too)
WHY_NOT = {
    "talking": {"zh": "先跟人告辞", "en": "Finish the talk first"},
    "busy": {"zh": "手上的事还没做完", "en": "Finish what you are doing first"},
    "stated_today": {
        "zh": "今天已经照讲稿说过一回",
        "en": "A statement has been made today already",
    },
    "incomplete": {"zh": "讲稿的三条还没写全", "en": "The three parts are not all filled in"},
    "no_venue": {
        "zh": "傍晚去茶馆说，或者等族长把族人召到祠堂",
        "en": "Go to the teahouse in the evening, or the hall once the elder has called the clan",
    },
    "not_evening": {
        "zh": "茶馆要到傍晚才有人听",
        "en": "The teahouse has an audience only in the evening",
    },
    "no_meeting": {
        "zh": "族长还没有召集族人，祠堂没有开",
        "en": "The elder has not called the clan, so the hall is closed",
    },
    "empty_room": {"zh": "这里没有人听", "en": "Nobody is here to hear it"},
    "few_present": {
        "zh": "在场的熟面孔不到五个",
        "en": "Fewer than five familiar faces are here",
    },
}
ORDINALS = {
    "zh": ("一", "二", "三", "四", "五", "六", "七", "八", "九"),
    "en": ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"),
}
PROOF = {
    "zh": "每一条都对，可你的凭据分不出是哪种说法",
    "en": "Every part holds, but what you hold cannot tell one story from the others",
}
# what was wrong with a part, said after the part: 「桥是怎么坏的」这一条，和更夫亲眼看见的不一样
FAILURE = {
    CONTRADICTED: {
        "zh": "和{who}亲眼看见的不一样",
        "en": "goes against what {who} saw with {own} own eyes",
    },
    UNSEEN: {"zh": "没有人亲眼看见", "en": "rests on nothing anyone saw"},
    UNSOURCED: {"zh": "话传走样了", "en": "rests on talk that changed as it was passed on"},
}
PART = {"zh": "「{title}」这一条，{text}", "en": "The part “{title}” {text}"}


# ---------------------------------------------------------------------------- the content


def card() -> dict[str, Any]:
    """The statement of the script."""
    return SCRIPT["statement"]


def opens() -> tuple[int, int]:
    """The day and the hour from which the full statement may be made."""
    when = card()["opens"]
    return when["day"], when["hour"]


def parts() -> list[dict[str, Any]]:
    return card()["parts"]


def part_of(part_id: str) -> dict[str, Any] | None:
    for part in parts():
        if part["id"] == part_id:
            return part
    return None


def option_of(part: dict[str, Any], option_id: str) -> dict[str, Any] | None:
    for option in part["options"]:
        if option["id"] == option_id:
            return option
    return None


def too_early(now: clock.Now) -> bool:
    """Whether the public meeting at which the full statement is first made has not come."""
    day, hour = opens()
    return (now.day, now.hour) < (day, hour)


# ---------------------------------------------------------------------------- the notes


def chosen(section: dict[str, Any]) -> dict[str, str]:
    """The option chosen in each part that has one, ``{part: option id}``."""
    return section.get(SECTION_KEY, {})


def picks(section: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The options chosen, as the script has them, ``{part: option}``."""
    found: dict[str, dict[str, Any]] = {}
    for part_id, option_id in chosen(section).items():
        part = part_of(part_id)
        option = None if part is None else option_of(part, option_id)
        if option is not None:
            found[part_id] = option
    return found


def filled(section: dict[str, Any]) -> bool:
    """Whether every part has an option chosen."""
    return all(part in picks(section) for part in PARTS)


def guessed(entry: dict[str, Any]) -> bool:
    """Whether the note is of what somebody only guesses, and so bears on nothing."""
    return "note" in entry and notebook.belief_of(entry).modality == "speculate"


def bearing(section: dict[str, Any], option: dict[str, Any]) -> tuple[list[str], list[str]]:
    """The entries of the notebook that bear for the option and against it, each in the order of
    the notebook."""
    pros, cons = set(option["supports"]), set(option["against"])
    weighed = [e for e in section["notebook"] if not guessed(e)]
    for_it = [e["id"] for e in weighed if e["prop"] in pros]
    against_it = [e["id"] for e in weighed if e["prop"] in cons]
    return for_it, against_it


def shown(section: dict[str, Any], part: dict[str, Any]) -> list[dict[str, Any]]:
    """The options of a part that a note bears on, as the frame has them."""
    out = []
    held = {e["id"]: number for number, e in enumerate(section["notebook"])}
    for option in part["options"]:
        pros, cons = bearing(section, option)
        if not pros and not cons:
            continue
        out.append(
            {
                "id": option["id"],
                "text": dict(option["text"]),
                "support": len(pros),
                "against": len(cons),
                "entries": sorted([*pros, *cons], key=held.__getitem__),
            }
        )
    return out


def is_shown(section: dict[str, Any], part: dict[str, Any], option: dict[str, Any]) -> bool:
    pros, cons = bearing(section, option)
    return bool(pros or cons)


def fillable(section: dict[str, Any]) -> bool:
    """Whether some part has no option chosen and an option to choose: one that a note speaks for
    (an option that only notes go against is shown, but there is nothing to choose in it)."""
    picked = chosen(section)
    return any(
        part["id"] not in picked and any(option["support"] for option in shown(section, part))
        for part in parts()
    )


# ---------------------------------------------------------------------------- judging


def right_option(part: dict[str, Any], variant: str) -> dict[str, Any]:
    """The option of the part that is right in the variant: the script has exactly one."""
    (one,) = [option for option in part["options"] if variant in option["right"]]
    return one


def wrong_parts(variant: str, chosen_options: dict[str, dict[str, Any]]) -> list[str]:
    """The parts, in order, whose chosen option is not the right one in the variant."""
    return [
        part["id"]
        for part in parts()
        if part["id"] in chosen_options and variant not in chosen_options[part["id"]]["right"]
    ]


def first_hand(entry: dict[str, Any]) -> bool:
    """Whether the note was seen by the manager or told by somebody who says they saw it."""
    belief = notebook.belief_of(entry)
    return belief.source == "saw" or (
        belief.source == "heard" and belief.claimed_source == SELF_SEEN
    )


def seer(entry: dict[str, Any]) -> str:
    """Who saw what a first-hand note says: the manager (``player``) or the person who told."""
    belief = notebook.belief_of(entry)
    return notebook.PLAYER_ID if belief.source == "saw" else str(belief.teller)


def failure(section: dict[str, Any], part: str, option: dict[str, Any]) -> list[str]:
    """How a part that is not right fails, from the notebook alone: ``[part, kind, who]``, with
    ``who`` the person whose sight it contradicts for ``contradicted`` and "" otherwise."""
    against, support = set(option["against"]), set(option["supports"])
    for entry in section["notebook"]:
        if entry["prop"] in against and first_hand(entry):
            return [part, CONTRADICTED, seer(entry)]
    if not any(entry["prop"] in support and first_hand(entry) for entry in section["notebook"]):
        return [part, UNSEEN, ""]
    return [part, UNSOURCED, ""]


# ---------------------------------------------------------------------------- the words


def ordinal(lang: str, number: int) -> str:
    return ORDINALS[lang][number - 1]


def too_early_words() -> dict[str, str]:
    day, _ = opens()
    return {
        "zh": f"要等第{ordinal('zh', day)}天傍晚，才能照讲稿当众说",
        "en": f"The statement has to wait for the evening of the {ordinal('en', day)} day",
    }


def why_not_words(reason: str) -> dict[str, str]:
    return too_early_words() if reason == "too_early" else dict(WHY_NOT[reason])


def _person(world: BridgeWorld, who: str) -> dict[str, str]:
    """A person as the words of a failure name them: you, or the name of the cast, which in English
    has the article a sentence wants (the Night Watchman)."""
    from lantern_core.world.bridge.lore import lore  # not at the top: the lore reads the script

    if who == notebook.PLAYER_ID:
        return {"zh": "你", "en": "you"}
    name = notebook._name(world, who)
    return {"zh": name["zh"], "en": lore().names.get(who, name)["en"]}


def failure_words(world: BridgeWorld, fail: list[str]) -> dict[str, str]:
    """A part that did not hold, with the kind of failure, in both languages."""
    part_id, kind, who = fail
    part = part_of(part_id)
    assert part is not None
    out = {}
    for lang in ("zh", "en"):
        name = _person(world, who)[lang] if who else ""
        text = FAILURE[kind][lang].format(
            who=name, own="your" if who == notebook.PLAYER_ID else "their"
        )
        out[lang] = PART[lang].format(title=part["title"][lang], text=text)
    return out


def failures_words(world: BridgeWorld, fails: list[list[str]]) -> dict[str, str]:
    said = [failure_words(world, fail) for fail in fails]
    return {
        "zh": "。".join(w["zh"] for w in said) + "。",
        "en": ". ".join(w["en"] for w in said) + ".",
    }


def why(world: BridgeWorld, world_state: dict[str, Any]) -> dict[str, str] | None:
    """What the last full statement fell short of, in words, or None if it told the truth or there
    has been none: the parts that did not hold first, each with the kind of failure, then that the
    proof was not enough, then the first condition of the goal that it missed."""
    from lantern_core.world.bridge import assembly, board  # not at the top: both read this module

    last = assembly.last_statement(world_state)
    if last is None or last["cleared"]:
        return None
    if last["fails"]:
        return failures_words(world, last["fails"])
    if not last["proof"]:
        return dict(PROOF)
    short = assembly.missed(world_state)
    return dict(board.SHORT[short]) if short else None


# ---------------------------------------------------------------------------- the frame


def used_today(world_state: dict[str, Any], now: clock.Now) -> bool:
    from lantern_core.world.bridge import assembly  # not at the top: assembly reads this module

    return assembly.stated_on(world_state, now.day)


def block(world: BridgeWorld, world_state: dict[str, Any], now: clock.Now) -> str | None:
    """Why a full statement cannot be made here and now, as a code of ``WHY_NOT`` or
    ``too_early``, else None."""
    from lantern_core.world.bridge import assembly  # not at the top: assembly reads this module

    section = world_state["player"]
    if too_early(now):
        return "too_early"
    if used_today(world_state, now):
        return "stated_today"
    if not filled(section):
        return "incomplete"
    if section["talk"]:
        return "talking"
    if section["busy"]:
        return "busy"
    place, why_not = assembly.venue(world, world_state, now)
    if why_not is not None:
        return why_not
    here = assembly.audience(world_state, place)
    if not here:
        return "empty_room"
    if len(here) < assembly.MIN_NAMED:
        return "few_present"
    return None


def last_wire(world: BridgeWorld, world_state: dict[str, Any]) -> dict[str, Any] | None:
    from lantern_core.world.bridge import assembly  # not at the top: assembly reads this module

    last = assembly.last_statement(world_state)
    if last is None:
        return None
    when = clock.at(last["tick"])
    return {
        "day": when.day,
        "hour": when.hour,
        "venue": last["venue"],
        "named": last["named"],
        "accepted": last["accepted"],
        "percent": last["percent"],
        "elder": last["elder"],
        "told": last["cleared"],
        "wrong": [fail[0] for fail in last["fails"]],
        "why": why(world, world_state),
    }


def wire(world: BridgeWorld, world_state: dict[str, Any], tick: int) -> dict[str, Any]:
    """The frame key ``statement`` at ``tick``."""
    section, now = world_state["player"], clock.at(tick)
    picked = chosen(section)
    out_parts = []
    for part in parts():
        options = shown(section, part)
        choice = picked.get(part["id"])
        out_parts.append(
            {
                "part": part["id"],
                "title": dict(part["title"]),
                "options": options,
                "chosen": choice if any(o["id"] == choice for o in options) else None,
                "gap": not options,
            }
        )
    reason = block(world, world_state, now)
    return {
        "parts": out_parts,
        "can_state": reason is None,
        "why_not": None if reason is None else why_not_words(reason),
        "used_today": used_today(world_state, now),
        "last": last_wire(world, world_state),
    }


def summary(world_state: dict[str, Any]) -> list[dict[str, Any]]:
    """The parts in short, for ``board.statement``: ``{"part", "support", "against", "gap"}``,
    the counts being those of the option chosen (nothing before one is)."""
    section = world_state["player"]
    picked = chosen(section)
    out = []
    for part in parts():
        options = shown(section, part)
        one = next((o for o in options if o["id"] == picked.get(part["id"])), None)
        out.append(
            {
                "part": part["id"],
                "support": 0 if one is None else one["support"],
                "against": 0 if one is None else one["against"],
                "gap": not options,
            }
        )
    return out


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """``statement``, in every frame of a world that has the card."""
    if SCRIPT.get("statement") is not None:
        out["statement"] = wire(world, state["world"], state["tick"])


# ---------------------------------------------------------------------------- the action


def validate(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action statement"
    out = converse.plain(body, "statement")
    op = body.get("op")
    if op not in (CHOOSE, CLEAR):
        raise InputError(f"{where}: op must be one of {CHOOSE}, {CLEAR}")
    out["op"] = op
    out["part"] = converse.id_field(body.get("part"), where, "part")
    if op == CHOOSE:
        out["option"] = converse.id_field(body.get("option"), where, "option")
    return out


def apply(sim: Any, body: dict[str, Any]) -> None:
    """Choose an option of a part, or clear the part. It costs no time."""
    section = sim.state["player"]
    part = part_of(body["part"])
    if part is None:
        return ack(sim, body, "unknown_part")
    if body["op"] == CLEAR:
        section.get(SECTION_KEY, {}).pop(part["id"], None)
        return ack(sim, body)
    option = option_of(part, body["option"])
    if option is None:
        return ack(sim, body, "unknown_option")
    if not is_shown(section, part, option):
        return ack(sim, body, "not_shown")
    section.setdefault(SECTION_KEY, {})[part["id"]] = option["id"]
    ack(sim, body)


ACTIONS = {"statement": (validate, apply)}
