"""The gift: a small thing the festival manager gives a person to earn a little of their trust, and
what the manager learns of what people like.

*The things.* The market gives away four small things each day, the same four, at no cost (the
``gifts`` of the script: tea, a pastry, lantern paper and wine). Each person likes some of them and
dislikes some (``likes`` and ``dislikes`` of the cast), and every other is neither.

*The gift.* ``{"type": "gift", "item": id, "npc"?: id}``, in a conversation, gives the person of the
talk one of the things. The town takes one gift a day, whoever it is for and whoever gives it, and a
person takes two in a game. A gift adds trust and nothing else::

    liked      the thing's ``gain`` in trust (all four are 8, the trust that a promise of the
               largest size earns when it is made, ``pledges.MADE_GAIN``, and one or two half
               hearts)
    neither    half of it (``NEUTRAL_SHARE``)
    disliked   nothing, and no harm either

It is no favour: nothing is written to the ledger of favours (``pledges.add_deed``), so what the
person owes the manager or the manager owes them is as it was, and the score of a request moves only
by the trust, as it does for a promise that is made. It is no way round a hard condition either: a
hard condition of the script (``persuade.HARD``) asks for something that trust does not give, a
clarification in public that the person took in, a role of honour promised, a word from the elder,
so the answer to the request is the same however much trust the gifts earned. At most one gift a day
in the town and two to a person is at most five gifts in a game and ``2 * 8`` trust to one person.

The values were tuned with the bots. The person's answer is a line of the
talk, in the kind ``said``: the person's own words for how they take it (the codes of
``phrases.GIFT`` in their voice, ``voices``), with the thing in them. The person's hearts move by
what the trust did (``hearts``, with the reason ``gift``).

*What the manager learns.* Giving a thing shows how the person takes it: the manager learns that
they like it, or do not, or are neither way. Asking someone who knows the person (a topic
``likes:<person>``, answered by someone of their family or household, someone they are acquainted
with, or the keeper of the teahouse, who knows everyone) learns up to two things at a time: the
first thing the person likes that the manager does not know yet, then the first they dislike. What
is learned is in ``tastes`` of the section ``player`` (``{person: {thing: "like" | "dislike" |
"neutral"}}``), and the frame has it as ``likes_known`` of the person.

State (keys of the section ``player``, there once there is something in them)::

    {"gifted": [[day, person, thing, like, tick], ...]     the gifts given, in order,
     "tastes": {person: {thing: like}}}                    what the manager has learned

The frame. ``hud.gift`` is ``{"day", "items": [{"id", "zh", "en"}], "given": bool, "to": person |
null}``: the things of the day, and whether the town's gift of the day is given and to whom. The
person in the frame (``people``) has ``gifts``, how many they have taken. The event ``gifted`` is
``{"npc", "item", "like", "gain"}``. Rejected: ``not_talking``, ``wrong_person``, ``unknown_item``,
``gift_today``, ``gift_full``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.inputs import InputError
from lantern_core.world.bridge import converse, phrases, repute, voices
from lantern_core.world.bridge.data import CAST, SCRIPT
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

PER_DAY = 1  # gifts the town takes in a day
PER_PERSON = 2  # gifts a person takes in a game
LIKE, DISLIKE, NEUTRAL = "like", "dislike", "neutral"
LIKED_SHARE, NEUTRAL_SHARE = 2, 1  # of two halves: a thing that is liked is all of its gain, one
# that is neither way half of it, and one that is disliked nothing
PREFIX = "likes:"  # the topic of a question about what a person likes
TASTE_ASKED = "taste"  # the ``answer`` of the event ``asked`` for such a question
MAX_TOLD = 2  # things a person tells of in one answer

# what a person tells of what another likes (``{name}`` is the other, as the one who tells names
# them, ``{liked}`` and ``{disliked}`` the things), and what they say when they have nothing to add
TOLD = {
    "both": {
        "zh": "{name}喜欢{liked}，不爱{disliked}。",
        "en": "{name} likes {liked} and does not care for {disliked}.",
    },
    "liked": {"zh": "{name}喜欢{liked}。", "en": "{name} likes {liked}."},
    "disliked": {"zh": "{name}不爱{disliked}。", "en": "{name} does not care for {disliked}."},
    "all": {
        "zh": "{name}喜欢什么，我知道的都说了。",
        "en": "That is all I know of what {name} likes.",
    },
    "unknown": {
        "zh": "{name}喜欢什么，我说不上来。",
        "en": "I could not say what {name} likes.",
    },
}


# ---------------------------------------------------------------------------- the things


def things() -> list[dict[str, Any]]:
    """The small things of the day, in the order of the script: ``{"id", "zh", "en", "gain"}``."""
    return [dict(row) for row in SCRIPT.get("gifts", ())]


def thing(item: str) -> dict[str, Any] | None:
    return next((row for row in SCRIPT.get("gifts", ()) if row["id"] == item), None)


def taste_of(person: str, item: str) -> str:
    """How ``person`` takes ``item``: ``like``, ``dislike`` or ``neutral``."""
    row = CAST["people"][lore().index[person]]
    if item in row["likes"]:
        return LIKE
    return DISLIKE if item in row["dislikes"] else NEUTRAL


def gain_of(row: dict[str, Any], like: str) -> int:
    """The trust a thing earns from a person who takes it as ``like``."""
    share = {LIKE: LIKED_SHARE, NEUTRAL: NEUTRAL_SHARE}.get(like, 0)
    return int(row["gain"]) * share // LIKED_SHARE


# ---------------------------------------------------------------------------- what was given


def given(section: dict[str, Any]) -> list[list[Any]]:
    """The gifts given so far, in order: ``[day, person, thing, like, tick]``."""
    return section.get("gifted", [])


def given_on(section: dict[str, Any], day: int) -> list[Any] | None:
    """The gift of the town on ``day``, or None."""
    return next((row for row in given(section) if row[0] == day), None)


def taken_by(section: dict[str, Any], person: str) -> int:
    """How many gifts ``person`` has taken."""
    rows = section.get("gifted")
    return 0 if not rows else sum(1 for row in rows if row[1] == person)


def hud(section: dict[str, Any], day: int) -> dict[str, Any]:
    """The key ``gift`` of the hud: the things of the day, and whether the day's gift is given."""
    row = given_on(section, day)
    return {
        "day": day,
        "items": [{key: item[key] for key in ("id", "zh", "en")} for item in things()],
        "given": row is not None,
        "to": None if row is None else row[1],
    }


def refusal(section: dict[str, Any], day: int, person: str) -> str | None:
    """Why a gift cannot be given to ``person`` now: ``gift_today`` (the town's gift of the day is
    given) or ``gift_full`` (they have taken two), else None."""
    if given_on(section, day) is not None:
        return "gift_today"
    if taken_by(section, person) >= PER_PERSON:
        return "gift_full"
    return None


def can_give(world_state: dict[str, Any], day: int) -> bool:
    """Whether the manager, in a talk, can give a small thing now: there are things to give, the
    town's gift of the day is not given and the person of the talk has not taken two."""
    section = world_state["player"]
    talk = section["talk"]
    return bool(talk) and bool(things()) and refusal(section, day, talk["npc"]) is None


# ---------------------------------------------------------------------------- what is learned


def tastes(section: dict[str, Any], person: str) -> dict[str, str]:
    """What the manager has learned of what ``person`` likes: ``{thing: like}``."""
    return section.get("tastes", {}).get(person, {})


def learn(section: dict[str, Any], person: str, item: str, like: str) -> None:
    section.setdefault("tastes", {}).setdefault(person, {})[item] = like


def known(section: dict[str, Any], person: str) -> list[dict[str, str]]:
    """The tastes of ``person`` as the frame has them, in the order of the things of the day:
    ``[{"item", "like"}]``."""
    learned = tastes(section, person)
    if not learned:
        return []
    return [
        {"item": row["id"], "like": learned[row["id"]]} for row in things() if row["id"] in learned
    ]


def fresh(section: dict[str, Any], person: str) -> tuple[str | None, str | None]:
    """The first thing ``person`` likes and the first they dislike that the manager has yet to
    learn (None for a kind with none left)."""
    row, learned = CAST["people"][lore().index[person]], tastes(section, person)
    liked = next((i for i in row["likes"] if i not in learned), None)
    disliked = next((i for i in row["dislikes"] if i not in learned), None)
    return liked, disliked


# ---------------------------------------------------------------------------- the gift


def validate(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action gift"
    out = converse.plain(body, "gift")
    out["item"] = converse.id_field(body.get("item"), where, "item")
    npc = body.get("npc", "")
    if npc != "" and (not isinstance(npc, str) or len(npc) > converse.MAX_ID_CHARS):
        raise InputError(f"{where}: npc must be a person's id")
    out["npc"] = npc
    return out


def reaction(person: str, row: dict[str, Any], like: str, at: int) -> dict[str, str]:
    """What ``person`` says to a gift they take as ``like``, in their own words, for a line kept
    until the tick ``at`` (which of their variants, as for any fixed line)."""
    words = voices.phrase(person, phrases.GIFT[like], at)
    return {lang: words[lang].replace("{item}", row[lang]) for lang in ("zh", "en")}


def apply(sim: Sim, body: dict[str, Any]) -> None:
    section = sim.state["player"]
    found = converse.partner(sim)
    if found is None:
        return converse.ack(sim, body, "not_talking")
    index = found[0]
    person = lore().people[index]
    if body["npc"] not in ("", person):
        return converse.ack(sim, body, "wrong_person")
    row = thing(body["item"])
    if row is None:
        return converse.ack(sim, body, "unknown_item")
    reason = refusal(section, sim.now.day, person)
    if reason is not None:
        return converse.ack(sim, body, reason)
    like = taste_of(person, row["id"])
    earned = gain_of(row, like)
    section.setdefault("gifted", []).append([sim.now.day, person, row["id"], like, sim.ctx.tick])
    learn(section, person, row["id"], like)
    if earned:
        repute.nudge(section, index, earned, "gift")
    talk = section["talk"]
    said = reaction(person, row, like, talk["until"])
    converse.say(section, person, talk["until"], "said", said["zh"], said["en"])
    converse.replied(sim, person)
    sim.emit("gifted", npc=person, item=row["id"], like=like, gain=earned)
    converse.ack(sim, body)


ACTIONS = {"gift": (validate, apply)}


# ---------------------------------------------------------------------------- asking about tastes


def is_taste(topic: str) -> bool:
    return topic.startswith(PREFIX)


def target_of(topic: str) -> str:
    return topic[len(PREFIX) :]


def knows(world: BridgeWorld, speaker: str, target: str) -> bool:
    """Whether ``speaker`` can say what ``target`` likes: they are of the same family or household,
    they are acquainted (``goals_call``), or they are the keeper of the teahouse, who keeps up with
    everyone (the hubs of the script)."""
    from lantern_core.world.bridge import goals_call

    if speaker == target:
        return False
    if speaker in SCRIPT.get("hubs", ()):
        return True
    cast = world.cast.people
    one, other = cast[world.cast.index[speaker]], cast[world.cast.index[target]]
    if one.home == other.home or (one.family is not None and one.family == other.family):
        return True
    layout = goals_call.lay(world)
    return target in layout.knows.get(speaker, ()) or speaker in layout.knows.get(target, ())


def _told(name: dict[str, str], liked: dict[str, str] | None, disliked: dict[str, str] | None):
    key = "both" if liked and disliked else "liked" if liked else "disliked"
    words = TOLD[key]
    said = {
        lang: words[lang].format(
            name=name[lang],
            liked="" if liked is None else liked[lang],
            disliked="" if disliked is None else disliked[lang],
        )
        for lang in ("zh", "en")
    }
    # a name the speaker uses may be common words ("my brother", "the clerk"), and the sentence
    # starts with it
    said["en"] = said["en"][:1].upper() + said["en"][1:]
    return said


def ask(sim: Sim, body: dict[str, Any]) -> None:
    """The person of the talk is asked what ``target`` likes (the topic ``likes:<target>``)."""
    section = sim.state["player"]
    found = converse.partner(sim)
    assert found is not None
    speaker = lore().people[found[0]]
    target = target_of(body["topic"])
    if target not in lore().index or target == speaker:
        return converse.ack(sim, body, "unknown_topic")
    name = voices.called(speaker, target)  # the other person, as the one asked names them
    talk = section["talk"]
    learned: list[dict[str, str]] = []
    if not knows(sim.world, speaker, target):
        words = {lang: TOLD["unknown"][lang].format(name=name[lang]) for lang in ("zh", "en")}
    else:
        liked, disliked = fresh(section, target)
        if liked is None and disliked is None:
            words = {lang: TOLD["all"][lang].format(name=name[lang]) for lang in ("zh", "en")}
        else:
            told = []
            for item, like in ((liked, LIKE), (disliked, DISLIKE)):
                if item is not None:
                    learn(section, target, item, like)
                    learned.append({"item": item, "like": like})
                    told.append(thing(item))
            words = _told(
                name,
                told[0] if liked is not None else None,
                told[-1] if disliked is not None else None,
            )
    converse.say(section, speaker, talk["until"], "said", words["zh"], words["en"])
    converse.replied(sim, speaker)
    sim.emit(
        "asked",
        npc=speaker,
        topic=body["topic"],
        answer=TASTE_ASKED if learned else "ignorant",
        path="",
        prop=None,
        source=None,
        entry=None,
        new=False,
        learned=learned,
    )
    converse.ack(sim, body)


def label(target: str) -> dict[str, str]:
    """The words of the topic ``likes:<target>`` in the list of topics."""
    name = lore().names[target]
    return {"zh": f"{name['zh']}喜欢什么", "en": f"What {name['en']} likes"}


def topics(
    world: BridgeWorld, section: dict[str, Any], partner: str, met: list[int]
) -> list[dict[str, Any]]:
    """The questions about tastes the manager can ask now: one for each person they know
    (``met``: the cast indexes of the people who have a card) other than the one they are
    talking to, whose tastes they have not learned in full."""
    out = []
    for index in met:
        person = world.cast.people[index].id
        if person == partner:
            continue
        liked, disliked = fresh(section, person)
        if liked is None and disliked is None:
            continue
        out.append({"id": PREFIX + person, "kind": "taste", "label": label(person)})
    return out
