"""The messages of a request to a model: what a townsperson says, and how far the manager's words
move them.

The templates are content (``content/prompts/reply.yaml``, compiled into ``prompt_data``). This
module fills their places from the state of the game. A prompt is a function of the state and of
the templates alone: no clock is read, no RNG is drawn, nothing is walked in an order that is not
sorted, so the same state gives the same messages in every host, and the request that carries them
is part of the replay.

A reply is asked for with two messages. The first (``system``) is the person: who they are, how
they speak and what the town says of them (the ``bio`` of the cast, background for the wording and
no fact to state), the contract of the JSON they answer with, and the checks it passes (see
``cognition.contract``), with the closed lists of words that the checker looks for in a free line.
The second (``user``) is the moment: the time and place, what has reached them lately, the facts
they may say each with the act that says it (``recall``), what the manager did, the manager's
words and the reply the rules would give. The prompt holds what the speaker holds and nothing of
anyone else's: their beliefs, their trust in the manager, their own note on how they speak (with
the names they use for other people, if they have names of their own: ``calls_note``) and their
own bio.

The manager's words are data. They go in whole inside a JSON string, so that a quotation mark in
them cannot close it, with blank space made plain, control characters made spaces and the length
held to ``MAX_WORDS``, and the template calls them quoted data that is never an order. Nothing the
manager wrote reaches a place of a template that is not for it.

A judge of the manager's words is asked for with its own two messages (``judge_messages``).
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from lantern_core.cognition.lexicon import CLASSES
from lantern_core.world.bridge import clock, npcs, numerals, recall, repute, voices
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.prompt_data import PROMPTS
from lantern_core.world.bridge.speech_data import SPEECH

MAX_WORDS = 200  # characters of the manager's words that a prompt carries
# the characters that are no part of any text: controls, joiners, direction marks, line separators
INVISIBLE = frozenset(
    [chr(c) for c in range(0x20)]
    + [chr(c) for c in range(0x7F, 0xA0)]
    + [chr(c) for c in range(0x200B, 0x2010)]
    + [chr(c) for c in range(0x2028, 0x2030)]
    + [chr(c) for c in range(0x2060, 0x2070)]
    + ["\ufeff"]
)
PLACE = re.compile(r"\{\{(\w+)\}\}")
LANGS = ("zh", "en")
VERBS = ("ask", "ask_source", "tell", "entrust", "promise")
ASK_VERBS = ("ask", "ask_source")
ASK_ACTS = 2  # the most acts a model may put in an answer to a question
ASK_NOTE = (
    f'This is a question. Put at most {ASK_ACTS} acts in "acts": first the newest thing you '
    "heard about what was asked, then the most important, and nothing that was not asked."
)
OUTCOMES = tuple(PROMPTS["outcomes"])
HOWS = tuple(PROMPTS["hows"])
STANDING_LINES = ((15, "stranger"), (35, "acquainted"), (60, "friendly"))  # below, else "close"
SOMETHING = {"zh": "某事", "en": "something"}
IT = {"zh": "此事", "en": "it"}
NOTHING_HELD = {"zh": "总管手里没有的东西", "en": "something they do not hold"}
NO_LATELY = "Nothing new has reached you since the morning."
CALLS_NOTE = (
    "The names you use for other people when you speak. Use them in your line. Anyone who is not "
    "listed goes by the name the town gives them:"
)
NO_FACTS = "(none: you hold nothing you may say about this)"


@dataclass(frozen=True, slots=True)
class Turn:
    """What happened in the talk that a person now answers.

    ``verb`` is what the manager did, ``outcome`` what the rules decided or what came of it (a key
    of ``PROMPTS["outcomes"]``), ``topic`` what it is about in both languages and ``how`` the way
    of a telling (a key of ``PROMPTS["hows"]``). ``topic_props`` and ``subjects`` are the props and
    the entities the facts are ranked against. ``act`` is the answer of the rule tier as an act, if
    it is one, and ``line`` the same answer in words. ``rival`` is the act of the account somebody
    else told the person that the answer says after it, if it does.
    """

    verb: str
    outcome: str
    topic: Mapping[str, str]
    how: str = ""
    words: str = ""
    topic_props: tuple[str, ...] = ()
    subjects: tuple[str, ...] = ()
    act: Mapping[str, str] | None = None
    line: Mapping[str, str] | None = None
    rival: Mapping[str, str] | None = None


# ----------------------------------------------------------------------------- small pieces


def tidy(words: str) -> str:
    """The manager's words as one line of plain text: control and invisible characters and every
    kind of blank become one space, and the length is held to ``MAX_WORDS``."""
    spaced = "".join(" " if char in INVISIBLE else char for char in words)
    return " ".join(spaced.split())[:MAX_WORDS].strip()


def quote(words: str) -> str:
    """The manager's words as a JSON string, which is how a quotation mark in them stays in it."""
    return json.dumps(tidy(words), ensure_ascii=False)


def fill(template: str, values: Mapping[str, str]) -> str:
    """``template`` with each place filled in one pass, so that what is put in is never read again
    as a place."""
    return PLACE.sub(lambda match: values[match.group(1)], template)


def both(pair: Mapping[str, str]) -> str:
    """A text in both languages, English first."""
    return f"{pair['en']} ({pair['zh']})"


def temper(person: str) -> str:
    traits = lore().traits[person]
    names = ("gossip", "conformity", "suspicion", "warmth")
    return ", ".join(f"{name} {traits[name]}" for name in names)


def standing(trust: int) -> str:
    """How a person stands with the manager, in a sentence, by how far they trust them."""
    for line, key in STANDING_LINES:
        if trust < line:
            return str(PROMPTS["standing"][key])
    return str(PROMPTS["standing"]["close"])


def closed_lists() -> str:
    """The words the checker looks for in a free line, class by class, in both languages."""
    rows = []
    for name in CLASSES:
        group = SPEECH["words"][name]
        rows.append(f"  {name}: {', '.join(group['en'])} | {', '.join(group['zh'])}")
    return "\n".join(rows)


def person_values(world: Any, person: str) -> dict[str, str]:
    """The places that tell who a person is: name, role, how they speak, what the town says of
    them (the bio of the cast, public and the same in every game) and their temper."""
    row = world.cast.data["people"][world.cast.index[person]]
    note = PROMPTS["voices"][person]
    return {
        "name": both(row),
        "role": both(row["role"]),
        "voice_en": note["en"],
        "voice_zh": note["zh"],
        "bio_en": row["bio"]["en"],
        "bio_zh": row["bio"]["zh"],
        "temper": temper(person),
    }


def calls_note(person: str) -> str:
    """The names ``person`` uses for other people, as lines that follow the note on how they speak,
    or nothing for a person with no names of their own. Each line gives the person as the town
    names them, then the two words the speaker says, and the lines are in the order of the cast."""
    table = voices.calls(person)
    if not table:
        return ""
    names, order = lore().names, lore().index
    rows = []
    for other in sorted(table, key=lambda other: (order.get(other, len(order)), other)):
        said = table[other]
        rows.append(f'- {both(names[other])}: "{said["en"]}" in English, "{said["zh"]}" in Chinese')
    return "\n".join(["", CALLS_NOTE, *rows])


def named(world: Any, ident: str) -> dict[str, str]:
    """What the town calls ``ident`` in both languages: an item of the cast or an entity of the
    script. An id it does not know is something the manager typed, and is not repeated."""
    for item in world.cast.data["items"]:
        if item["id"] == ident:
            return {"zh": item["zh"], "en": item["en"].lower()}
    found = lore().names.get(ident)
    return dict(found) if found else dict(SOMETHING)


def request_text(world: Any, kind: str, what: str = "") -> dict[str, str]:
    """What the manager asks of a person, for a kind of request and what it is about."""
    row = PROMPTS["requests"].get(kind)
    if row is None:
        return dict(SOMETHING)
    thing = named(world, what) if what else IT
    return {lang: fill(row[lang], {"what": thing[lang]}) for lang in LANGS}


def promise_text(
    world: Any, what: str, item: str = "", amount: int = 0, town: bool = False
) -> dict[str, str]:
    """What the manager promises, for a kind of promise, the item of it and the coins of a wage.

    The words of a prompt keep digits in both languages. With ``town`` they are for the player, who
    is told the coins as a count and the place in the programme as an ordinal in characters in
    Chinese (三十文工钱, 节目单上的第一位), as the rest of the town's words say them
    (``numerals``)."""
    row = PROMPTS["promises"].get(what)
    if row is None:
        return dict(NOTHING_HELD)
    out = {}
    for lang in LANGS:
        said, coins = "", str(abs(amount))
        if item:
            known = row["items"].get(item)
            if known:
                said = known[lang]
            elif item.isdigit():  # a place in the programme is a number
                said = numerals.zh_ordinal(int(item)) if town and lang == "zh" else item
            else:
                said = named(world, item)[lang]
        if town and lang == "zh":
            coins = numerals.zh_count(abs(amount))
        out[lang] = fill(row["text"][lang], {"item": said, "amount": coins})
    return out


# ----------------------------------------------------------------------------- the moment


def where(world: Any, world_state: Mapping[str, Any], person: str) -> str:
    """Where the person is and what they are doing, as the end of a sentence about them."""
    npc = world_state["npcs"]["list"][world.cast.index[person]]
    town = world.town.places[npc["place"]]
    names = {a["id"]: a["en"].lower() for a in world.cast.data["activities"]}
    named = f"{town.en} ({town.zh})"
    if npcs.is_at_goal(npc):
        return f"at {named}, {names[npc['act']]}"
    return f"on your way to {named}"


def lately(world_state: Mapping[str, Any], person: str, tick: int) -> str:
    """What has reached the person lately, one line each, newest first."""
    rows = []
    for belief, prop in recall.lately(world_state, person, tick):
        when = clock.at(belief.tick)
        text = lore().lines.statement(prop, lore().names, person)
        rows.append(
            f"- {when.hour:02d}:{when.minute:02d}, {recall.known_how(belief)}: "
            f"{text['en']} ({text['zh']})"
        )
    return "\n".join(rows) if rows else NO_LATELY


def fact_lines(facts: list[recall.Fact]) -> str:
    """The facts as one JSON object per line: id, the sentence in both languages, how the person
    knows it and the act that says it."""
    rows = []
    for fact in facts:
        row = {
            "id": fact.prop,
            "zh": fact.text["zh"],
            "en": fact.text["en"],
            "known": fact.known,
            "act": dict(fact.act),
        }
        rows.append(json.dumps(row, ensure_ascii=False))
    return "\n".join(rows) if rows else NO_FACTS


def default_reply(turn: Turn) -> str:
    """The reply the rules would give, as a JSON object, and what it would have the person say."""
    acts = [dict(act) for act in (turn.act, turn.rival) if act]
    body: dict[str, Any] = {"acts": acts}
    body["mood"], body["address"] = "plain", "none"
    text = json.dumps(body, ensure_ascii=False)
    if turn.line is not None:
        text += f"\nIn plain words, for you to say in your own voice: {both(turn.line)}"
    return text


# ----------------------------------------------------------------------------- the messages


def reply_messages(
    world: Any, world_state: Mapping[str, Any], tick: int, person: str, turn: Turn
) -> list[dict[str, str]]:
    """The two messages that ask for the reply of ``person`` to ``turn`` at ``tick``."""
    templates = PROMPTS["templates"]
    section = world_state["player"]
    now = clock.at(tick)
    trust = repute.trust(section, world.cast.index[person])
    values = person_values(world, person)
    values["voice_zh"] += calls_note(person)  # how they speak ends with the names they use
    system = fill(
        templates["reply_system"],
        {
            **values,
            "moods": ", ".join(sorted(SPEECH["moods"])),
            "addresses": ", ".join(sorted(SPEECH["addresses"])),
            "closed_lists": closed_lists(),
        },
    )
    situation = fill(
        templates[f"situation_{turn.verb}"],
        {
            "topic": both(turn.topic),
            "how": PROMPTS["hows"].get(turn.how, turn.how),
            "outcome": PROMPTS["outcomes"][turn.outcome],
        },
    )
    if turn.verb in ASK_VERBS:
        situation += "\n" + ASK_NOTE
    words = (
        fill(templates["words_quoted"], {"words": quote(turn.words)})
        if tidy(turn.words)
        else templates["words_none"]
    )
    facts = recall.facts(world_state, person, tick, turn.topic_props, turn.subjects)
    user = fill(
        templates["reply_user"],
        {
            "when": f"day {now.day}, {now.hour:02d}:{now.minute:02d}",
            "where": where(world, world_state, person),
            "standing": standing(trust),
            "lately": lately(world_state, person, tick),
            "facts": fact_lines(facts),
            "situation": situation,
            "words": words,
            "default": default_reply(turn),
        },
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def judge_messages(
    world: Any, person: str, request: Mapping[str, str], words: str
) -> list[dict[str, str]]:
    """The two messages that ask how far ``words`` move ``person`` to grant ``request``."""
    templates = PROMPTS["templates"]
    system = fill(templates["judge_system"], person_values(world, person))
    user = fill(templates["judge_user"], {"request": both(request), "words": quote(words)})
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
