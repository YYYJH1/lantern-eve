"""The numbers that the words of a task may carry, and how they are filled in.

The words of a task (``why``, ``next`` and ``blocker`` in ``content/scripts/broken_bridge.yaml``)
may name a number that the player can see: "the bridge needs {bamboo_need} poles of bamboo and has
{bamboo_site}". A name in braces is one of ``NAMES``, and the frame puts in the value it has when it
is made. A number is said in digits in English and in characters in Chinese (``zh_count`` of
``numerals``: 四, 两, 十二), except the grudge, which is a score and keeps its digits; the name of a
family or a time is said in each language.
The title of a task has no slot, since it is quoted in the reason a followed task changes for; the
exception is the title of a task that keeps one of the manager's promises (``pledge``), which names
the person, and is filled in where it is quoted too.
``tools/check_content.py`` holds the words to this table, and a test holds the two equal.

Every value is read from what the player is shown or what the town shows in public: the pile at
the bridge (``site``), what people promised the manager (``commitments``), who has joined and of
which family, and the hours of work done (the ``bridge`` of the hud). None is read from the variant
that is true or from what a person believes.

The board of the frame (``board``) shows the same numbers, and takes them from the functions here
(``crew_counts``, ``hours_done``, ``deadline_time``, ``next_work_window``) and from the tables of
``goals_work``, so that a task and the board cannot say two things.

==================  ================================================================================
name                value
==================  ================================================================================
``bamboo_site``     the poles of bamboo that lie at the bridge (``timber_site`` for the timber)
``bamboo_need``     the poles the bridge needs (``goals_work.NEED``)
``bamboo_lack``     the poles it still lacks: the need less the pile, at least 0
``bamboo_open``     the poles of bamboo that someone promised and are not there yet, 0 if none
``bamboo_next``     the poles that the next promise would be for, 0 if the bridge lacks none that
                    nobody has promised (``commitments.batch_for``); the same for the timber
``helpers``         the people who have agreed to help
``crew``            the people the work takes (``goals_call.CREW``)
``li_helpers``      of them, those of the Li family (``zhou_helpers``: of the Zhou family)
``needy``           the family with nobody yet, "the Li family", or "both families" if both
``hours``           the hours of work done at the bridge
``hours_need``      the hours the bridge takes (``goals_work.BRIDGE_HOURS``)
``work_from``       the hour the helpers begin work in the morning, "08:00" in both languages
``work_to``         the hour they stop, "12:00"
``deadline``        the time the work has to be done by, "by 18:00 on day 4"
``helper``          the person the card names to ask to join next (``agenda.helper``)
``hours_left``      the hours of work still to do: the hours the bridge takes less those done
``morning``         the hours the helpers give in one morning: one each, the helpers who have joined
``pledgeN_to``      the person the manager's N-th promise was made to, as ``pledgeN_what`` says
                    what it was (a front-row stall at the festival, 10 coins in wages) and
                    ``pledgeN_due`` the day it is to be kept by, "day 4" (N from 1 to
                    ``pledges.CARDS``: the script writes ``{pledge_to}`` once, and the compiled
                    tasks of the promises each have their own number)
``grudge``          the grudge between the heads of the two families, as the board shows it
                    (the metric of the festival, from 0 to 100)
==================  ================================================================================
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import (
    clock,
    commitments,
    goals,
    goals_call,
    goals_work,
    pledges,
    weather,
)
from lantern_core.world.bridge.numerals import zh_count

if TYPE_CHECKING:
    from lantern_core.world.bridge.world import BridgeWorld

ITEMS = ("bamboo", "timber")
PLEDGE_PARTS = ("to", "what", "due")
NAMES = (
    *(f"{item}_{part}" for item in ITEMS for part in ("site", "need", "lack", "open", "next")),
    "helpers",
    "crew",
    "li_helpers",
    "zhou_helpers",
    "needy",
    "hours",
    "hours_need",
    "work_from",
    "work_to",
    "deadline",
    "helper",
    "hours_left",
    "morning",
    *(f"pledge{n}_{part}" for n in range(1, pledges.CARDS + 1) for part in PLEDGE_PARTS),
    "grudge",
)
SCORES = ("grudge",)  # numbers on a scale, which every language writes in digits
SLOT = re.compile(r"\{(\w+)\}")
PLEDGE_SLOT = re.compile(r"pledge(\d+)_(\w+)")
FAMILIES = {"li_helpers": "fam_li", "zhou_helpers": "fam_zhou"}
FAMILY_WORDS = {
    "fam_li": {"zh": "李家", "en": "the Li family"},
    "fam_zhou": {"zh": "周家", "en": "the Zhou family"},
}
EITHER = {"zh": "李、周两家", "en": "both families"}

Words = dict[str, str]


def slots(words: Words) -> set[str]:
    """The names written in braces in either language of ``words``."""
    return {name for lang in ("zh", "en") for name in SLOT.findall(words[lang])}


def has_slots(words: Words) -> bool:
    return "{" in words["zh"] or "{" in words["en"]


# ------------------------------------------------------------ the numbers the board shares


def call_of(world_state: dict[str, Any]) -> dict[str, Any] | None:
    """The call for helpers, or None where the section ``goals`` is not the festival's."""
    return world_state["goals"]["call"] if goals.keeps_the_goals(world_state) else None


def crew_counts(world: BridgeWorld, world_state: dict[str, Any]) -> tuple[int, dict[str, int]]:
    """The people who have agreed to help, and how many of them are of each family (nobody, where
    there is no call)."""
    call = call_of(world_state)
    if call is None:
        return 0, {family: 0 for family in goals_call.lay(world).families}
    return goals_call.crew(world, call)


def hours_done(world_state: dict[str, Any]) -> int:
    """The hours of work done at the bridge, as the hud has them: never more than it takes."""
    if not goals.keeps_the_goals(world_state):
        return 0
    ticks = world_state["goals"]["work"]["ticks"]
    return min(goals_work.BRIDGE_HOURS, ticks // clock.DAY_TICKS_PER_HOUR)


def deadline_time() -> clock.Now:
    """The time the work has to be done by: the deadline of the goal ``g_labor``."""
    return clock.at(goals_work.labor_deadline())


def window_tick(day: int, hour: int) -> int:
    """The tick at which the clock reaches ``hour`` o'clock of the day phase of ``day``."""
    return (day - 1) * clock.CYCLE_TICKS + clock.hour_start(hour)


def morning_over(now: clock.Now, day: int) -> bool:
    """Whether the morning of work of ``day`` is over at ``now``."""
    if day != now.day:
        return day < now.day
    return now.phase == clock.NIGHT or now.hour >= goals_work.WORK_END_HOUR


def rained_out(world_state: dict[str, Any], now: clock.Now, day: int) -> bool:
    """Whether the morning of work of ``day`` is lost to a heavy rain as far as the player can tell:
    it is today, and today's sky is a heavy rain (the sky of a day to come is not known)."""
    return day == now.day and weather.today(world_state) == weather.HEAVY_RAIN


def next_work_window(
    world: BridgeWorld, world_state: dict[str, Any], now: clock.Now
) -> dict[str, Any] | None:
    """The next morning the helpers work at the bridge, the one that is going on included unless a
    heavy rain has lost it, or None if there is none left: the work is done, the game is over, or
    the deadline of the goal falls before the morning begins."""
    g = world_state["goals"]
    if "g_labor" in g["done"] or g["ending"]:
        return None
    day = max(goals_work.WORK_FROM_DAY, now.day)
    if morning_over(now, day) or rained_out(world_state, now, day):
        day += 1
    start = window_tick(day, goals_work.WORK_START_HOUR)
    if day > world.config["days"] or start > goals_work.labor_deadline():
        return None
    return {
        "day": day,
        "from": goals_work.WORK_START_HOUR,
        "to": goals_work.WORK_END_HOUR,
        "place": goals_work.BRIDGE,
    }


def mornings_left(world: BridgeWorld, world_state: dict[str, Any], now: clock.Now) -> int:
    """The mornings of work that can still be done before the deadline of the goal ``g_labor``, as
    far as the player can tell: the morning that is going on, if it is not over and the sky today
    is not a heavy rain, and every later one that begins before the deadline (the sky of a day to
    come is not known)."""
    day = max(goals_work.WORK_FROM_DAY, now.day)
    if morning_over(now, day):
        day += 1
    count = 0
    while (
        day <= world.config["days"]
        and window_tick(day, goals_work.WORK_START_HOUR) <= goals_work.labor_deadline()
    ):
        count += 0 if rained_out(world_state, now, day) else 1
        day += 1
    return count


def hour_words(hour: int) -> Words:
    """An hour on the clock as the page writes it, in both languages: 08:00."""
    return {"zh": f"{hour:02d}:00", "en": f"{hour:02d}:00"}


def day_words(day: int) -> Words:
    """A day of the game as a person says it, in each language: 第四日 and day 4."""
    numeral = commitments.NUMERALS[day] if 0 < day < len(commitments.NUMERALS) else str(day)
    return {"zh": f"第{numeral}日", "en": f"day {day}"}


def morning_hours(world: BridgeWorld, world_state: dict[str, Any]) -> int:
    """The hours of work the helpers give in one morning, an hour each: all who have joined if
    they are a crew (enough of them, of both families), else none, since the work does not begin."""
    call = call_of(world_state)
    if call is None or not goals_call.crew_ready(world, call):
        return 0
    return goals_call.crew(world, call)[0]


# what the words say of a promise that is not there to be read (a name not yet in use)
NO_PLEDGE = {
    "to": {"zh": "对方", "en": "that person"},
    "what": {"zh": "许下的东西", "en": "what was promised"},
    "due": {"zh": "到期那天", "en": "the day it falls due"},
}


class Facts:
    """The values of ``NAMES`` for a game as it stands, each worked out when it is first asked for
    (most frames have no use for any of them)."""

    __slots__ = ("_known", "state", "world")

    def __init__(self, world: BridgeWorld, world_state: dict[str, Any]) -> None:
        self.world = world
        self.state = world_state
        self._known: dict[str, Any] = {}

    def __getitem__(self, name: str) -> Any:
        if name not in self._known:
            self._known[name] = self._work_out(name)
        return self._known[name]

    def _work_out(self, name: str) -> Any:
        state = self.state
        if name in FAMILIES:
            return self._per_family()[FAMILIES[name]]
        for item in ITEMS:
            if name.startswith(item + "_"):
                return self._of_item(item, name[len(item) + 1 :])
        if name == "helpers":
            return crew_counts(self.world, state)[0]
        if name == "crew":
            return goals_call.CREW
        if name == "needy":
            return self._needy()
        if name == "hours":
            return hours_done(state)
        if name == "hours_need":
            return goals_work.BRIDGE_HOURS
        if name == "work_from":
            return hour_words(goals_work.WORK_START_HOUR)
        if name == "work_to":
            return hour_words(goals_work.WORK_END_HOUR)
        if name == "deadline":
            when = deadline_time()
            return commitments.when_words(when.day, when.hour)
        if name == "helper":
            return self._helper()
        if name == "hours_left":
            return max(0, goals_work.BRIDGE_HOURS - hours_done(state))
        if name == "morning":
            return morning_hours(self.world, state)
        found = PLEDGE_SLOT.fullmatch(name)
        if found is not None and found.group(2) in PLEDGE_PARTS:
            return self._pledge(int(found.group(1)), found.group(2))
        if name == "grudge":
            return state["goals"]["metrics"]["grudge"] if goals.keeps_the_goals(state) else 0
        raise KeyError(name)

    def _pledge(self, number: int, part: str) -> Words:
        """A part of the words about the manager's ``number``-th promise: to whom, what and by
        when."""
        from lantern_core.world.bridge import prompts  # not at the top: prompts reads the state
        from lantern_core.world.bridge.lore import lore

        row = pledges.card_of(self.state["player"], number)
        if row is None:
            return dict(NO_PLEDGE[part])
        if part == "to":
            return dict(lore().names[row["to"]])
        if part == "due":
            return day_words(row["due"])
        return prompts.promise_text(self.world, row["what"], row["item"], row["amount"], town=True)

    def _of_item(self, item: str, part: str) -> int:
        site = commitments.site(self.state)[item]
        need = goals_work.NEED[item]
        if part == "site":
            return site
        if part == "need":
            return need
        lack = max(0, need - site)
        if part == "lack":
            return lack
        promised = sum(
            row["amount"]
            for row in self.state[commitments.SECTION]["list"]
            if row["item"] == item and row["state"] == commitments.PROMISED
        )
        if part == "open":
            return promised
        if part == "next":
            return commitments.batch_for(item, lack - promised) if lack > promised else 0
        raise KeyError(f"{item}_{part}")

    def _helper(self) -> Words:
        """The name of the person the card names to ask to join (see ``agenda.helper``)."""
        from lantern_core.world.bridge import agenda  # not at the top: agenda reads this module
        from lantern_core.world.bridge.lore import lore

        who = agenda.helper(self.world, self.state)
        return dict(lore().names[who]) if who is not None else {"zh": "对方", "en": "that person"}

    def _per_family(self) -> dict[str, int]:
        return crew_counts(self.world, self.state)[1]

    def _needy(self) -> Words:
        none = [family for family, count in self._per_family().items() if count == 0]
        if len(none) == 1:
            return dict(FAMILY_WORDS[none[0]])
        return dict(EITHER)


def fill(words: Words, facts: Facts) -> Words:
    """``words`` with every ``{name}`` put in: a number is in digits in English and in characters
    in Chinese (a score, the grudge, is in digits in both), and a name or a time is said in each.
    A name that is not one of ``NAMES`` is an error of the content."""
    out = {}
    for lang in ("zh", "en"):

        def put(found: re.Match[str], lang: str = lang) -> str:
            name = found.group(1)
            value = facts[name]
            if isinstance(value, dict):
                return value[lang]
            if lang == "zh" and isinstance(value, int) and name not in SCORES:
                return zh_count(value)
            return str(value)

        out[lang] = SLOT.sub(put, words[lang])
    return out
