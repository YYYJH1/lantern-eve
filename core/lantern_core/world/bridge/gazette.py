"""The paper of the morning and the summary of the night.

Each morning, from the second day, the schoolmaster's paper says what changed the day before, what
is on today and what the street says. Each night, at dusk, the manager is told what changed today,
what still stands in the way and what the first step of tomorrow is. Both are made by rules from
what the manager knows or the town saw in public, and worded by the templates of the script
(``paper``, in both languages). No model writes a word of them. They read the dealings of the
manager, the public record, the tasks of the frame and the street, and nothing of the variant that
is true or of what a person believes.

The frame has two keys, both in every frame of the bridge world and null but in the frame of the
call that made them (like ``recap``)::

    "gazette"  {"day": int,                                the day of the issue, 2 or later
                "head": {"kind", "text": {zh, en}},        the change that matters most
                "news": [{"kind", "text"}],                up to two short items
                "today": {"id", "text", "state", "window", "next"} | null,   the task followed
                "more": [{"id", "text", "state", "window", "next"}],   up to two more chances today
                "talk": [{"kind", "text"}]}                one or two lines of street talk
    "night"    {"day": int,                                the day that is ending
                "changed": {"kind", "text"},               what changed today
                "blocked": {"id", "text", "blocker"} | null,   the most urgent task that is blocked
                "step": {"id", "text", "window"} | null}   the first thing to do tomorrow

*The items.* An item is a thing that happened in a stretch of the game, with a ``kind``, words, and
the numbers of the events it is made from (none for a thing the town saw in public that no event of
the journal carries). The record of the recap keeps the numbers, as the lines of the recap do; the
frame has the kind and the words alone, since a number of an event counts every event of the game,
the talk of the townsfolk among them, and the paper says nothing that depends on that.

From the journal of the recap (``commitments``) come the ``delivery``, ``stance`` and ``promise``
of the recap, with its words, and the deeds of the peace (``peace``): ``stopped``, a head who stops
accusing in public, and ``side_by_side``, a morning of work at the bridge by the helpers of both
families. From the state come what the town saw in public: the bridge mended,
the truth told, the families at peace (flags of the festival raised in the stretch), a full
statement in public and a showing of evidence in public (``assembly.last_statement`` and
``last_showing``: one that moved nobody is ``statement_refused`` or ``evidence_refused``, which is
no change and comes late), a meal the families' heads shared, the helpers who joined, the work at
the bridge (why it stopped, or how far it has got), and the sky. The kinds are in ``RANK``, the
most important first, and the headline
is the first; the short items are the most important of each other kind before a second of any
kind, as the recap has it (``front``). A milestone takes the place of the lesser thing it holds (the
truth told takes the statement that told it, the peace the meal, the mended bridge the work). When
nothing happened the item is ``quiet``.

*The morning.* At the hour of the recap (``commitments._recap``) the items since the last recap are
made and the first three kept in the record of the recap as ``news``, with ``street``, what the
street was like (the townsfolk without names: ``keen``, and ``li`` and ``zhou``, the people on the
side of each family) and ``talk``, the kinds of the lines of street talk. ``street`` is the
yardstick of the morning after, which says whether the street warmed or cooled and which side it
turned to. A record made before the paper has none of these, and the paper then has the lines of the
recap for its items. ``today`` is the task the manager follows (the top bar), else the most urgent
that is live, with its time and place; ``more`` are the other live tasks with a time today, the
earliest first. They are worked out from the keys ``tasks`` and ``tracked`` of the frame, so the
paper and the top bar cannot say two things.

*The street's two accounts.* When two accounts of how the rail broke are each given out in public by
at least a tenth of the named townsfolk (``ACCOUNT_VOICES``), the paper says the street has two
stories. It is made from what the named townsfolk said in public places, where others could hear
(``social`` keeps the latest account of the conflict each of them gave there, ``aloud``), and from
nothing a person believes in secret. The accounts are groups of the props said, by whom or what they
blame (a family standing for its members), counted by the people who said them in the last two days.
The item comes with the rest of the street's news, below the things the manager did and above the
festival's work and the sky, and it is told once for a pair of accounts and again only if the pair
is another (the record of the recap keeps ``accounts``). It names the accounts as the town words
them and says nothing of which is true.

*The street talk.* Of the festival, one line: the street warmer or cooler than at the last morning
(a change of ``swing`` keen townsfolk), else warm, mixed or cool by how many are keen (``warm``,
``cool``, the same count that the turnout of the side panel is made from). Of the two families, at
most one: the peace or the truth told, while it is fresh (``fresh`` days); else the street turning
to a side since the last morning; else a side with the people for it, or a split street. Of who went
about the day before, at most one, where the card has room (``TALK_LINES``) or in the place of a
line that only says how the street stands: that some people went to look at the bridge, called on
one another or lent a hand there, by the kind that was most often done in public
(``reflection``), and never who, or what they had in mind. The street
is the one thing in the paper that reads the townsfolk without names: it is public in the town (they
are the people one passes in the street), the paper says only which way they lean and never why,
and it reads nothing of the variant that is true or of the thoughts of a named person. The tests
change everything hidden and compare, and change the street and see the street talk follow.

*The night.* At dusk (the first tick of the night phase) of every day but the last, whose dusk is
the ending's. ``changed`` is the first item of the day, from the hour of the morning's recap;
``blocked`` the most urgent task that is blocked, with the words of what blocks it; ``step`` the
live task whose time tomorrow comes first, else the task that is followed, without a time. It is
made when the frame is, from the state, and keeps nothing: the frame of any later call has it
null.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import (
    agenda,
    agenda_facts,
    assembly,
    board,
    clock,
    commitments,
    crowd,
    goals,
    notebook,
    reflection,
    weather,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

# the kinds of item, the most important first
RANK = (
    "bridge_mended",
    "truth_told",
    "reconciled",
    "statement",
    "evidence",
    "meal",
    "delivery",
    "helpers",
    "stance",
    "two_accounts",
    "stopped",
    "side_by_side",
    "work_stopped",
    "work",
    "promise",
    "statement_refused",
    "evidence_refused",
    "rain",
    "quiet",
)
SHORT = 2  # short items under the headline
PER_KIND = 2  # items of a kind of the journal that are weighed
MORE = 2  # other chances today
MORNING, NIGHT = "morning", "night"
HEAVY, LIGHT = weather.HEAVY_RAIN, weather.LIGHT_RAIN


@dataclass(frozen=True, slots=True)
class Rules:
    """The ``paper`` of the script: when it is, how the street is read, the words. ``manager`` is
    the manager as each card names them (the Manager in the paper of the morning, you in the summary
    of the night) and ``progress`` how far the work at the bridge has got, in words."""

    when: dict[str, dict[str, str]]
    manager: dict[str, dict[str, str]]
    progress: dict[str, dict[str, str]]
    street: dict[str, int]
    news: dict[str, dict[str, str]]
    talk: dict[str, dict[str, str]]


@functools.cache
def rules() -> Rules:
    raw = SCRIPT.get("paper")
    if not raw:
        raise KeyError("the script has no paper")
    return Rules(
        raw["when"], raw["manager"], raw["progress"], raw["street"], raw["news"], raw["talk"]
    )


def progress_words(done: int, need: int) -> dict[str, str]:
    """How far the work at the bridge has got, in words, by the share of the hours done: under a
    third, under a half, a half, or more (integers only)."""
    if done * 3 < need:
        key = "start"
    elif done * 2 < need:
        key = "under_half"
    elif done * 2 == need:
        key = "half"
    else:
        key = "over_half"
    return dict(rules().progress[key])


def other_family(person: str) -> dict[str, str]:
    """The name of the family that ``person`` is not of, of the two (the Li and the Zhou families),
    as the words of the tasks say it: 李家 and "the Li family"."""
    own = lore().family.get(person)
    other = "fam_zhou" if own == "fam_li" else "fam_li"
    return dict(agenda_facts.FAMILY_WORDS[other])


@dataclass(frozen=True, slots=True)
class Item:
    """One thing that happened, as the paper tells it."""

    kind: str
    text: dict[str, str]
    events: tuple[int, ...] = ()
    order: int = 0  # the newer the larger: a tick, or the number of the event

    def wire(self) -> dict[str, Any]:
        """The item as the record of the recap keeps it."""
        return {"kind": self.kind, "text": dict(self.text), "events": list(self.events)}


# ---------------------------------------------------------------------------- the street's accounts

ACCOUNT_DAYS = 2  # the days back that what a named person said in public still counts
ACCOUNT_VOICES = 2  # named people (a tenth of them) who must have given an account for it to be
# the street's


def account_key(prop: Any) -> str:
    """Whose account of the rail a prop is: the cause is the flood, or the one blamed, a person
    standing for their family (what a family is blamed for is said of its members too)."""
    if prop.pred == "flood_damaged":
        return "flood"
    who = prop.arg("who")
    return str(lore().family.get(who) or who)


def accounts_aloud(world_state: dict[str, Any], until: int) -> list[tuple[str, int, str]]:
    """The accounts of how the rail broke that at least ``ACCOUNT_VOICES`` named people gave out in
    public in the last ``ACCOUNT_DAYS`` days up to tick ``until``, as ``(account, people, the
    prop most of them said)``, the most voiced first (ties in the order of the accounts)."""
    aloud = world_state["social"].get("aloud")
    if not aloud:  # nobody said any (or the world has no talk between neighbours at all)
        return []
    view = notebook.view(world_state["social"])
    since = until - ACCOUNT_DAYS * clock.CYCLE_TICKS
    said: dict[str, dict[str, int]] = {}
    for speaker in sorted(aloud):
        prop_id, tick = aloud[speaker]
        if since < tick <= until and prop_id in view:
            ways = said.setdefault(account_key(view[prop_id]), {})
            ways[prop_id] = ways.get(prop_id, 0) + 1
    rows = [
        (key, sum(ways.values()), min(ways, key=lambda pid: (-ways[pid], pid)))
        for key, ways in sorted(said.items())
    ]
    rows = [row for row in rows if row[1] >= ACCOUNT_VOICES]
    return sorted(rows, key=lambda row: -row[1])


def the_two_accounts(world_state: dict[str, Any], until: int) -> list[tuple[str, int, str]]:
    """The two accounts the street has most of the named people for, or none if there is not a
    second one."""
    rows = accounts_aloud(world_state, until)
    return rows[:2] if len(rows) >= 2 else []


def _accounts(world_state: dict[str, Any], until: int) -> list[Item]:
    """The item that says the street has two stories, unless the last paper said it of these two."""
    rows = the_two_accounts(world_state, until)
    if not rows:
        return []
    last = world_state[commitments.SECTION]["recap"].get("accounts")
    if last == sorted(row[0] for row in rows):
        return []
    lo, view = lore(), notebook.view(world_state["social"])
    first, second = (lo.lines.statement(view[row[2]], lo.names) for row in rows)
    words = commitments.fill(rules().news["two_accounts"], first=first, second=second)
    return [Item("two_accounts", words, order=until)]


# ---------------------------------------------------------------------------- the items


def _stretch(world_state: dict[str, Any], since: int, until: int) -> list[tuple[str, int]]:
    """The flags raised after tick ``since`` up to tick ``until``, each with its tick."""
    flags = world_state["goals"]["flags"]
    return [(flag, tick) for flag, tick in flags.items() if since < tick <= until]


def _public(
    world: BridgeWorld, world_state: dict[str, Any], since: int, until: int, which: str
) -> list[Item]:
    """What the town saw in public in the stretch after ``since`` up to ``until`` (the module)."""
    said, found = rules().news, []
    raised = dict(_stretch(world_state, since, until))
    mended = "bridge_fixed" in raised
    told = "truth_told" in raised
    peace = "reconciled" in raised
    if mended:
        found.append(Item("bridge_mended", said["bridge_mended"], order=raised["bridge_fixed"]))
    if told:
        found.append(Item("truth_told", said["truth_told"], order=raised["truth_told"]))
    if peace:
        found.append(Item("reconciled", said["reconciled"], order=raised["reconciled"]))
    elif "reconcile_seen" in raised:
        found.append(Item("meal", said["meal"], order=raised["reconcile_seen"]))
    last = assembly.last_statement(world_state)
    if last is not None and since < last["tick"] <= until and not (told and last["cleared"]):
        kind = "statement" if last["accepted"] > 0 else "statement_refused"
        words = commitments.fill(
            said[kind],
            place=commitments._place(world, last["venue"]),
            named=last["named"],
            accepted=last["accepted"],
            manager=rules().manager[which],
        )
        found.append(Item(kind, words, order=last["tick"]))
    shown = assembly.last_showing(world_state)
    if shown is not None and since < shown["tick"] <= until:
        kind = "evidence" if shown["accepted"] > 0 else "evidence_refused"
        words = commitments.fill(
            said[kind],
            place=commitments._place(world, shown["venue"]),
            named=shown["named"],
            accepted=shown["accepted"],
            manager=rules().manager[which],
        )
        found.append(Item(kind, words, order=shown["tick"]))
    joined = [row for row in world_state["goals"]["call"]["joined"] if since < row[1] <= until]
    if joined:
        words = commitments.fill(said["helpers"], n=len(joined))
        found.append(Item("helpers", words, order=joined[-1][1]))
    wired = board.wire(world, world_state, until)
    if not mended and wired["stop"] is not None:
        words = commitments.fill(said["work_stopped"], why=wired["stop"])
        found.append(Item("work_stopped", words, order=until))
    elif not mended and 0 < wired["hours"]["done"] < wired["hours"]["need"]:
        done, need = wired["hours"]["done"], wired["hours"]["need"]
        words = commitments.fill(
            said["work"], hours=done, left=need - done, progress=progress_words(done, need)
        )
        found.append(Item("work", words))
    found.extend(_accounts(world_state, until))
    day = clock.at(until).day - (1 if which == MORNING else 0)
    sky = weather.on_day(world_state, day)
    if sky in (HEAVY, LIGHT):
        template = said["rain_heavy" if sky == HEAVY else "rain_light"]
        found.append(Item("rain", commitments.fill(template, when=rules().when[which])))
    return found


def _journal(world: BridgeWorld, journal: list[list[Any]], which: str) -> list[Item]:
    """The lines of the recap that the journal can make (``commitments.found``), as items, with the
    manager named as the card of ``which`` names them."""
    found = []
    for kind, rows in commitments.found(world, journal, manager=rules().manager[which]).items():
        for number, events, text in rows[:PER_KIND]:
            found.append(Item(kind, text, tuple(events), number))
    return found


def _deeds(world: BridgeWorld, journal: list[list[Any]]) -> list[Item]:
    """The deeds of the peace in the journal (``peace``): a head who stopped accusing in public, and
    a morning on which the helpers of both families worked at the bridge."""
    found = []
    for number, kind, _, note in journal:
        if kind != "eased":
            continue
        if note.get("act") == "stop_blaming":
            who = commitments._person(world, note.get("npc"))
            other = other_family(str(note.get("npc")))
            words = commitments.fill(rules().news["stopped"], who=who, other=other)
            found.append(Item("stopped", words, (number,), number))
        elif note.get("act") == "work_together":
            found.append(
                Item("side_by_side", dict(rules().news["side_by_side"]), (number,), number)
            )
    return found


def collect(
    world: BridgeWorld,
    world_state: dict[str, Any],
    journal: list[list[Any]],
    since: int,
    until: int,
    which: str,
) -> list[Item]:
    """The things of the stretch after tick ``since`` up to tick ``until``, the most important
    first and the newest first among those of a kind. ``which`` is ``MORNING`` for the stretch that
    ended at the hour of the recap and ``NIGHT`` for the one that ends at dusk. There is always one:
    when nothing happened, ``quiet``."""
    found = [
        *_journal(world, journal, which),
        *_deeds(world, journal),
        *_public(world, world_state, since, until, which),
    ]
    if not found:
        words = commitments.fill(rules().news["quiet"], when=rules().when[which])
        found.append(Item("quiet", words, order=until))
    return sorted(found, key=lambda item: (RANK.index(item.kind), -item.order))


def front(items: list[Item]) -> list[Item]:
    """The headline and the short items of a list of items (most important first): the first, then
    the most important of each other kind before a second of any kind, up to ``SHORT`` short ones,
    in the order of the list. It is the way the recap prefers a kind it has not got yet."""
    chosen = items[:1]
    for item in items[1:]:
        if len(chosen) <= SHORT and all(item.kind != other.kind for other in chosen):
            chosen.append(item)
    for item in items[1:]:
        if len(chosen) <= SHORT and item not in chosen:
            chosen.append(item)
    return sorted(chosen, key=items.index)


# ---------------------------------------------------------------------------- the street


def street_now(world_state: dict[str, Any]) -> dict[str, int]:
    """How the townsfolk without names stand: how many are keen for the festival, and how many are
    on the side of each family (``li``, the lean of -100, and ``zhou``, 100)."""
    camp = rules().street["camp"]
    lean = world_state["crowd"]["stance"]
    return {
        "keen": crowd.keen_count(world_state),
        "li": sum(1 for stance in lean if stance <= -camp),
        "zhou": sum(1 for stance in lean if stance >= camp),
    }


def _fresh(world_state: dict[str, Any], flag: str, tick: int) -> bool:
    """Whether the flag was raised within the days the street still talks of it."""
    raised = world_state["goals"]["flags"].get(flag)
    return raised is not None and tick - raised <= rules().street["fresh"] * clock.CYCLE_TICKS


def street_talk(world_state: dict[str, Any], before: dict[str, int] | None, tick: int) -> list[str]:
    """The kinds of the lines of street talk at ``tick``, against how the street was at the last
    morning (``before``, None at the first): one of the festival, then at most one of the families
    (see the module)."""
    rule, now = rules().street, street_now(world_state)
    keen = now["keen"]
    if before is not None and keen - before["keen"] >= rule["swing"]:
        kinds = ["festival_up"]
    elif before is not None and before["keen"] - keen >= rule["swing"]:
        kinds = ["festival_down"]
    else:
        kinds = ["festival_warm" if keen >= rule["warm"] else "festival_mixed"]
        if keen < rule["cool"]:
            kinds = ["festival_cool"]
    lean = now["li"] - now["zhou"]
    turn = 0 if before is None else lean - (before["li"] - before["zhou"])
    if _fresh(world_state, "reconciled", tick):
        kinds.append("peace")
    elif _fresh(world_state, "truth_told", tick):
        kinds.append("talked_out")
    elif turn >= rule["lean_swing"]:
        kinds.append("li_more")
    elif turn <= -rule["lean_swing"]:
        kinds.append("zhou_more")
    elif now["li"] >= rule["split"] and now["zhou"] >= rule["split"] and abs(lean) < rule["side"]:
        kinds.append("split")
    elif lean >= rule["side"]:
        kinds.append("li_side")
    elif lean <= -rule["side"]:
        kinds.append("zhou_side")
    return kinds


# ---------------------------------------------------------------------------- the morning


TALK_LINES = 2  # the lines of street talk the card of the page has room for
STANDING = ("li_side", "zhou_side", "split")  # the lines that say how the street stands, not news


def _room_for_the_walkers(street: list[str], walkers: list[str]) -> list[str]:
    """The street's lines, and the line about who went about the day before: it has the room that is
    left, and the place of a line that only says how the street stands, as it did yesterday. The
    changes of the street come first."""
    if walkers and len(street) >= TALK_LINES and street[-1] in STANDING:
        street = street[:-1]
    return [*street, *walkers][:TALK_LINES]


def print_morning(sim: Sim, last: dict[str, Any], journal: list[list[Any]]) -> dict[str, Any]:
    """What the recap record keeps of the paper of this morning: ``news``, the headline and the
    short items made of the events since the last recap (``last``, the record before this one) and
    of what the town saw in public, ``street`` and ``talk``. Nothing in a world that does not keep
    the goals of the festival."""
    world, world_state = sim.world, sim.state
    if not goals.keeps_the_goals(world_state):
        return {}
    tick = sim.ctx.tick
    items = collect(world, world_state, journal, last["tick"], tick, MORNING)
    before = last.get("street")
    kept = {
        "news": [item.wire() for item in front(items)],
        "street": street_now(world_state),
        "talk": _room_for_the_walkers(
            street_talk(world_state, before, tick),
            reflection.street_kinds(world_state, last["tick"], tick),  # who went about, by kind
        ),
    }
    accounts = the_two_accounts(world_state, tick)
    if accounts:  # the pair the street has, so that the next paper tells it once
        kept["accounts"] = sorted(row[0] for row in accounts)
    return kept


def _shown(row: dict[str, Any]) -> dict[str, Any]:
    """An item of the record as the frame has it: its kind and its words."""
    return {"kind": row["kind"], "text": dict(row["text"])}


def _task(row: dict[str, Any]) -> dict[str, Any]:
    """A task of the frame as the paper names it."""
    return {
        "id": row["id"],
        "text": dict(row["text"]),
        "state": row["state"],
        "window": None if row["window"] is None else dict(row["window"]),
        "next": None if row["next"] is None else dict(row["next"]),
    }


def _live(out: dict[str, Any]) -> list[dict[str, Any]]:
    """The tasks of the frame that are open or blocked, the most urgent first."""
    return [row for row in out.get("tasks") or [] if row["state"] in agenda.LIVE]


def _today(out: dict[str, Any], day: int) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """What is to be done today and the other chances today (see the module)."""
    live = _live(out)
    chosen = next((row for row in live if row["id"] == out.get("tracked")), None)
    chosen = chosen or (live[0] if live else None)
    timed = [
        row
        for row in live
        if row is not chosen and row["window"] is not None and row["window"]["day"] == day
    ]
    timed.sort(key=lambda row: row["window"]["from"])
    seen = [] if chosen is None else [chosen["window"]]  # one chance for each time and place
    more = []
    for row in timed:
        if row["window"] not in seen and len(more) < MORE:
            seen.append(row["window"])
            more.append(_task(row))
    return (None if chosen is None else _task(chosen)), more


def _gazette(out: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    """The paper of the morning the record of the recap kept, with what is to be done today made
    from the frame that is being made."""
    news = record.get("news")
    if news is None:  # a record from before the paper: its lines are the news
        news = [
            {"kind": "recap", "text": row["text"], "events": row["events"]}
            for row in record["lines"]
        ]
    if not news:
        words = commitments.fill(rules().news["quiet"], when=rules().when[MORNING])
        news = [Item("quiet", words).wire()]
    said = rules().talk
    today, more = _today(out, record["day"])
    return {
        "day": record["day"],
        "head": _shown(news[0]),
        "news": [_shown(row) for row in news[1:]],
        "today": today,
        "more": more,
        "talk": [{"kind": kind, "text": dict(said[kind])} for kind in record.get("talk", [])],
    }


# ---------------------------------------------------------------------------- the night


def _dusk(world: BridgeWorld, state: dict[str, Any]) -> clock.Now | None:
    """The clock at the first tick of the night phase, if the call of this frame simulated it, and
    it is no dusk of the last day, whose night is the ending's."""
    if state["tick"] < 1:
        return None
    now = clock.at(state["tick"] - 1)
    if now.phase != clock.NIGHT or now.phase_tick != 0 or now.day >= world.config["days"]:
        return None
    return now


def _night(
    world: BridgeWorld, state: dict[str, Any], out: dict[str, Any], now: clock.Now
) -> dict[str, Any]:
    """The summary of the night that ends the day of ``now`` (the first tick of the night)."""
    world_state = state["world"]
    section = world_state[commitments.SECTION]
    recap = section["recap"]
    since = recap["tick"] if recap["day"] >= 2 else -1
    items = collect(world, world_state, section["journal"], since, now.tick, NIGHT)
    live = _live(out)
    stuck = next((row for row in live if row["state"] == agenda.BLOCKED), None)
    tomorrow = [
        row for row in live if row["window"] is not None and row["window"]["day"] == now.day + 1
    ]
    tomorrow.sort(key=lambda row: row["window"]["from"])
    follows = next((row for row in live if row["id"] == out.get("tracked")), None)
    step = tomorrow[0] if tomorrow else follows
    return {
        "day": now.day,
        "changed": _shown(items[0].wire()),
        "blocked": None
        if stuck is None
        else {
            "id": stuck["id"],
            "text": dict(stuck["text"]),
            "blocker": None if stuck["blocker"] is None else dict(stuck["blocker"]),
        },
        "step": None
        if step is None
        else {
            "id": step["id"],
            "text": dict(step["text"]),
            "window": None if step["window"] is None else dict(step["window"]),
        },
    }


# ---------------------------------------------------------------------------- the frame


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """``gazette`` and ``night``, null but in the frame of the call that made them. They need the
    keys ``tasks`` and ``tracked``, so this is called once every hook has filled the frame."""
    out["gazette"] = None
    out["night"] = None
    world_state = state["world"]
    if (
        commitments.SECTION not in world_state
        or not goals.keeps_the_goals(world_state)
        or world_state["goals"]["ending"]
    ):
        return
    record = world_state[commitments.SECTION]["recap"]
    if record["day"] >= 2 and state["tick"] == record["tick"] + 1:
        out["gazette"] = _gazette(out, record)
    dusk = _dusk(world, state)
    if dusk is not None:
        out["night"] = _night(world, state, out, dusk)
