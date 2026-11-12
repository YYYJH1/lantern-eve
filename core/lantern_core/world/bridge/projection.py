"""What the frame shows the player: every key and field of it, marked, and the same for the events.

The frame is the one thing a page reads, so it has to hold what the player knows and nothing the
game knows beyond that. This module is the audit of it. Each row names a key of the frame, the
fields of it that the row speaks for (none listed: all of them, and what is below), and one of three
marks:

``known``    the player has been shown it, has asked for it, or can work it out from what they did:
             the notebook, the tasks, the cards, the money, what they can do. A hop of a rumour that
             they have not asked about is not here, and neither is what a person believes in secret.
``public``   anyone looking at the map sees it: where people stand and what they do, the clock, the
             sky, a lantern at a door, a telling on its way. It is not a secret of the game, and it
             is not a thing that the player has learned either.
``debug``    only for tools. A page must not show it.

``FRAME`` and ``EVENTS`` are the audit, and ``problems`` says which keys of a real frame no row
speaks for, so that a key added to the frame without a mark is caught by a test. The tables in the
docstring of the package are made from the rows (``table``), and a test holds them equal.
``markdown`` makes the same tables for a document.

The audit found two leaks in the frame, F1 and F2, and both are closed:

* F1. ``dots[].topic`` was made with the variant that is true: a claim that someone broke the rail
  was ``blame`` if the game did not make it true and ``clear`` if it did, so the colour of a dot
  told a false accusation from a true one. It is made from the telling alone now (``Lore.topic``:
  an accusation, a denial or a cause that is nobody's doing, or neither), and the variant plays no
  part in it.
* F2. ``bubbles`` carried the words of every telling in the town, whether or not the player was
  near enough to hear (``overhear.HEARING``). Now the words are over a head only for a telling the
  manager can hear, or for the person they are talking to. Any other telling is a bubble with
  ``text`` null and ``talking`` true, which says that people are talking and not what about.

The scene is not the frame. It is what the core says once about the world the client draws, the same
in every game of a scenario and said before the first tick, so nothing in it can come from play or
from what is true in a game. ``SCENE`` marks the part of it that is about people, the cast: who each
person is, and ``bio``, what the town says of them. Both are ``public`` (``bio`` is static content
that anyone may read from the first minute), and a test holds every field of the cast of a real
scene to a row and every frame to having no ``bio``.

The key ``board`` is made from the flags of the festival and the numbers it keeps, who joined the
call, the weather of the days that are over, the clock and the last statement the manager made in
public (``board``). It reads nothing of the variant that is true or of what a person believes, and
the tests change those and compare, along the routes of the three stories.

The keys ``judgments`` and ``hint`` are what the manager judged and asked for, and the checks behind
them read the logic of the notes and nothing else (``judge``). The new keys ``tasks``, ``tracked``
and ``cards`` are made from the notebook, the claims the player was given or overheard, the events
that ``agenda`` keeps, the clock, the routines of the cast (public) and the content of the script.
They read nothing of the variant that is true, of what a person believes (but through what the
player was told), or of the hops of a rumour the player has not traced, and the tests change those
and compare. What a person keeps in mind against what they hold, a rival account, is on the card
only as what they said of it to the player, in the same answer as their stand (``stance.rival``):
a person who keeps one and did not say so has none on their card.

The key ``people`` is made from the cast (the same for everyone), what the manager did with each
person (the first talk, the promises, the favours, the gifts, what they learned of the person's
tastes, where and when they met, what they asked in return) and the clock. It reads nothing of the
variant that is true or of what a person believes: a test plays the same game under each story and
holds the whole key equal. The line the town says of each person (``cast[].intro``) is in the scene
and not in the rows, and the hearts are the trust and favours the manager earned, which they may
see.

The keys ``gazette`` and ``night`` are made from the tasks of the frame, the events the recap
reads (the manager's own dealings), the flags and numbers of the festival, the weather of the days
that are over, the clock, and what the named townsfolk said in public places (``gazette``: the
street's two stories, which the tests change and see follow, and change everything hidden and see
stay). Their street talk is the one part that reads the
townsfolk without names, who are the people one passes in the street: it says which way the street
leans and never why, it is marked ``public``, and the tests change the street and see it follow,
and change everything else hidden and see it stay.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from itertools import zip_longest
from typing import Any, NamedTuple

KNOWN, PUBLIC, DEBUG = "known", "public", "debug"
MARKS = (KNOWN, PUBLIC, DEBUG)


class Row(NamedTuple):
    """One row of the audit: a key, the fields it speaks for, its mark, and why (two languages)."""

    path: str
    fields: tuple[str, ...]
    mark: str
    en: str
    zh: str


def row(path: str, fields: str, mark: str, en: str, zh: str) -> Row:
    return Row(path, tuple(fields.split()), mark, en, zh)


FRAME: tuple[Row, ...] = (
    row(
        "npcs[]",
        "id x y activity carrying status",
        PUBLIC,
        "where each person stands and what they do, as the map draws them",
        "每个人站在哪里、在做什么，地图上就是这样画的",
    ),
    row("time", "day hour minute phase", PUBLIC, "the clock", "时钟"),
    row("weather", "", PUBLIC, "the sky of the day", "今天的天气"),
    row(
        "bubbles[]",
        "npc text until talking",
        PUBLIC,
        "words over a head, only within earshot; farther off, just that people are talking",
        "头顶的话，听得到的才有字；远处只表示有人在说话",
    ),
    row(
        "dots[]",
        "id from to progress",
        PUBLIC,
        "a telling on its way from one person to another",
        "一次转述正在从一个人传向另一个人",
    ),
    row(
        "dots[].topic",
        "",
        PUBLIC,
        "its colour, from what the telling says and not from which story is true",
        "光点的颜色，只看这次转述说了什么，不看哪个说法是真的",
    ),
    row(
        "lanterns[]",
        "household place x y",
        PUBLIC,
        "a lantern hung at the door of a household that promised",
        "答应来灯会的人家门前挂着的灯笼",
    ),
    row(
        "hud",
        "keen spent held cap stage cloud local verbs verbs_off reputation resources pledges"
        " gift promised turnout bridge ending",
        KNOWN,
        "the side panel: money, what can be done and why not, standing, promises, the day's gifts",
        "侧栏：游戏的花费、能做和不能做的事及原因、人望、许诺、今天的小东西、灯会的筹备",
    ),
    row(
        "player",
        "x y activity talk costs look offers topics",
        KNOWN,
        "where the manager stands, whom they talk to, what acts cost, what is in reach, "
        "what to say",
        "总管站在哪里、在和谁谈话、每件事要花多久、手边有什么、能说什么",
    ),
    row("player.thinking", "", PUBLIC, "whose words are being waited for", "正在等谁开口"),
    row(
        "people[]",
        "id known hearts likes_known gifts card met asked",
        KNOWN,
        "who each person is, how close they stand, what the manager learned of them,"
        " where they met",
        "每个人是谁、有多亲近、总管打听到他们的什么，以及在哪里、什么时候见过",
    ),
    row(
        "notebook[]",
        "id text source at marks chain",
        KNOWN,
        "what the manager was told or saw and when, and the hops of the trail they asked about",
        "总管听来、看到的事，什么时候、在哪里，以及追问过的那几跳",
    ),
    row(
        "judgments[]",
        "a b relation made",
        KNOWN,
        "how two notes stand to each other, as the manager judged it and the core found it holds",
        "总管判断的两条见闻之间的关系，核对过确实成立",
    ),
    row(
        "hint",
        "a b relation",
        KNOWN,
        "the pair of notes a hint lit, and how they stand once the manager asked again",
        "提示点亮的一对见闻，再问一次才说出它们的关系",
    ),
    row(
        "statement",
        "parts can_state why_not used_today last",
        KNOWN,
        "the statement card: options a note bears on, the manager's choices, the last statement",
        "讲稿：有见闻可依的说法、总管选了哪个，以及最近一次完整陈述",
    ),
    row(
        "tasks[]",
        "id kind job text why next state blocker action window expected",
        KNOWN,
        "worked out from the notebook, what the manager did, the clock and the routines",
        "由见闻簿、总管做过的事、时钟和作息得出",
    ),
    row("tracked", "", KNOWN, "the task the manager follows", "总管正在追踪的事项"),
    row(
        "commitments[]",
        "id by to what item amount due state reason",
        KNOWN,
        "what people promised the manager, and whether it came",
        "别人答应总管的事，以及有没有兑现",
    ),
    row(
        "site",
        "bamboo timber",
        PUBLIC,
        "what lies at the bridge, as the map shows it",
        "桥边堆着的料，地图上看得见",
    ),
    row(
        "recap[]",
        "text events",
        KNOWN,
        "the sheet of the morning, made from the events of the day before",
        "早上那张纸，由前一天发生的事拼成",
    ),
    row(
        "gazette",
        "day head news today more talk",
        KNOWN,
        "the paper of the morning: what changed, what is on today, what the street says",
        "早上的《镇报》：昨天的变化、今天的事、街上怎么说",
    ),
    row(
        "gazette.talk[]",
        "kind text",
        PUBLIC,
        "what the street says, as anyone walking the town hears it",
        "街上的人怎么说，走在街上的人都听得到",
    ),
    row(
        "night",
        "day changed blocked step",
        KNOWN,
        "the summary of the night: what changed, what is in the way, the step for tomorrow",
        "夜里的小结：今天变了什么、什么还拦着、明天的一步",
    ),
    row(
        "cards[]",
        "id name role family met find wants favours stance agreed",
        KNOWN,
        "who they are is public; the rest is what the manager met, asked or learned",
        "是谁是公开的，其余是总管见过、问过、了解到的",
    ),
    row(
        "ending",
        "",
        KNOWN,
        "null before the last night, then how the night went, and the reveal with it",
        "终夜之前是 null，之后是这一夜的结果，以及随之揭晓的真相",
    ),
    row(
        "board",
        "helpers need both hours window stop deadline needs statement truth peace",
        KNOWN,
        "how the three jobs stand: the helpers, the work, the last statement in public, the grudge",
        "三件事的进展：帮手、施工、最近一次当众陈述、积怨",
    ),
    row(
        "moments[]",
        "kind tick place x y prop from round",
        KNOWN,
        "the moments of the festival so far, and for an echo who brought the words back",
        "灯会里已出现的几个时刻；回声是说总管说过的话绕回来了，是谁带回来的",
    ),
    row(
        "moment_hold",
        "",
        KNOWN,
        "the moments the world is held for, until the page lets it go on",
        "世界为哪几个时刻停着，等页面放行",
    ),
)

EVENTS: tuple[Row, ...] = (
    row("dawn dusk weather", "", PUBLIC, "the day and its sky", "天亮、天黑和天气"),
    row(
        "task_start task_done task_fail taken delivered",
        "",
        PUBLIC,
        "the errand of a person, which the map shows",
        "某个人的差事，地图上看得见",
    ),
    row(
        "action_ack arrived talk_start talk_end declined asked heard look_start look_refused"
        " inspected",
        "",
        KNOWN,
        "what the manager did, and what came of it",
        "总管做了什么，结果如何",
    ),
    row(
        "told[manager] lie_caught entrusted entrust_done entrust_withdrawn testified convened"
        " pledged pledge_empty pledge_kept pledge_broken spoke stated feast answered",
        "",
        KNOWN,
        "the dealings of the manager with people",
        "总管和人打交道的事",
    ),
    row(
        "hearts gifted",
        "",
        KNOWN,
        "how close a person stands to the manager now, and how a small thing was taken",
        "某人和总管的亲近程度变了；一件小东西送出去，对方怎么收",
    ),
    row(
        "rally joined promised agreed flag goal ending eased",
        "",
        KNOWN,
        "the state of the festival, and the deeds that ease the grudge",
        "灯会的筹备，以及让两家积怨降下来的事",
    ),
    row(
        "moment",
        "",
        KNOWN,
        "a moment of the festival that the page stops the world for",
        "页面为之停下世界的灯会时刻",
    ),
    row("task_changed", "", KNOWN, "which task is followed, and why", "追踪的事项换了，以及为什么"),
    row(
        "commitment recap",
        "",
        KNOWN,
        "a promise made to the manager, broken or taken back; the recap of the morning",
        "别人答应总管的事有了变化；早上的回顾",
    ),
    row(
        "judged",
        "",
        KNOWN,
        "the manager judged how two notes stand, and it holds",
        "总管判断了两条见闻的关系，判对了",
    ),
    row(
        "clarified objection_withdrawn",
        "",
        KNOWN,
        "a clarification made in public, and an objection that fell",
        "当众做的一次澄清，以及撤回的阻拦",
    ),
    row(
        "downgrade budget_stage void",
        "",
        KNOWN,
        "the model calls and the money",
        "模型调用和花费",
    ),
    row(
        "told[townsfolk] conflict street refused",
        "",
        DEBUG,
        "how a rumour changed on its way: the operator, the rule, the path",
        "传言一路上怎么变的：改法、规则、路径",
    ),
    row(
        "reflected errand",
        "",
        DEBUG,
        "what a person thought over in the night and the errand chosen; the player sees only "
        "the person going about",
        "夜里每个人想了什么、选了什么差事；玩家只看到这个人在街上走动",
    ),
)

SCENE: tuple[Row, ...] = (
    row(
        "cast[]",
        "id zh en role token family home work",
        PUBLIC,
        "who each person is, as the page draws them: names, role, family, home and workplace",
        "每个人是谁，页面照这些来画：名字、身份、家族、住处和做工的地方",
    ),
    row(
        "cast[].intro",
        "",
        PUBLIC,
        "what the town says in a line of who the person is, static content, the same in every game",
        "镇上人用一句话说这个人是谁，是静态内容，每一局都一样",
    ),
    row(
        "cast[].bio",
        "",
        PUBLIC,
        "what the town says of the person, static content that is the same in every game",
        "镇上人怎么说这个人，是静态内容，每一局都一样",
    ),
)


# ---------------------------------------------------------------------------- the check


def paths(value: Any, prefix: str = "") -> Iterator[str]:
    """Every path of a frame: the keys of a dict joined by dots, ``[]`` for the items of a list."""
    if isinstance(value, dict):
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else key
            yield path
            yield from paths(item, path)
    elif isinstance(value, list):
        for item in value:
            yield from paths(item, f"{prefix}[]")


def speaks_for(entry: Row, path: str) -> bool:
    """Whether the row is the one for ``path``: the key itself, a field it lists (all of them if
    it lists none) and what is below."""
    if path == entry.path or path == entry.path.removesuffix("[]"):
        return True
    if not path.startswith(entry.path + "."):
        return False
    head = re.split(r"[.\[]", path[len(entry.path) + 1 :], maxsplit=1)[0]
    return not entry.fields or head in entry.fields


def mark_of(path: str, rows: tuple[Row, ...] = FRAME) -> str | None:
    """The mark of a path of the frame (or of the scene, with ``SCENE`` as the rows), from the row
    that speaks for it. The most specific wins (a row for ``dots[].topic`` over the one for
    ``dots[]``, which does not list it)."""
    found = [entry for entry in rows if speaks_for(entry, path)]
    if not found:
        return None
    return max(found, key=lambda entry: len(entry.path)).mark


def problems(frame: dict[str, Any], rows: tuple[Row, ...] = FRAME) -> list[str]:
    """The paths of a frame that no row of the audit speaks for, sorted."""
    return sorted({path for path in paths(frame) if mark_of(path, rows) is None})


def scene_problems(scene: dict[str, Any]) -> list[str]:
    """The paths of the cast of a scene that no row of ``SCENE`` speaks for, sorted."""
    return problems({"cast": scene.get("cast", [])}, SCENE)


def visible(event: dict[str, Any]) -> bool:
    """Whether the player may be shown an event: not the debug ones. A telling between townsfolk is
    a ``told`` whose speaker is not the manager."""
    kind = event["kind"]
    if kind in ("conflict", "street", "refused", "reflected", "errand"):
        return False
    return not (kind == "told" and event.get("speaker") != "player")


# ---------------------------------------------------------------------------- the tables

INDENT, LINE = 4, 100  # the table is set in the docstring of a package, indented, in 100 columns


def wrap(text: str, width: int) -> list[str]:
    """``text`` in lines of at most ``width`` characters, broken at spaces (a longer word has a
    line of its own)."""
    lines: list[str] = []
    for word in text.split():
        if lines and len(lines[-1]) + 1 + len(word) <= width:
            lines[-1] += " " + word
        else:
            lines.append(word)
    return lines or [""]


def table(rows: tuple[Row, ...] = FRAME, *, fields: bool = True) -> str:
    """The audit as a fixed-width table of text, for a docstring. Events have no fields."""
    widths = [22, 6, 24] if fields else [46, 6]
    why = LINE - INDENT - sum(widths) - 2 * len(widths)
    head = ["key", "mark"] + (["fields"] if fields else []) + ["why"]

    def lay(cells: list[list[str]]) -> list[str]:
        out = []
        for parts in zip_longest(*cells, fillvalue=""):
            line = "  ".join(
                part.ljust(width) for part, width in zip(parts, [*widths, 0], strict=True)
            )
            out.append(line.rstrip())
        return out

    lines = lay([[name] for name in head])
    lines.append("  ".join("-" * width for width in [*widths, why]))
    for entry in rows:
        cells = [wrap(entry.path, widths[0]), [entry.mark]]
        if fields:
            cells.append(wrap(" ".join(entry.fields) or "all", widths[2]))
        cells.append(wrap(entry.en, why))
        lines += lay(cells)
    return "\n".join(lines)


def markdown(lang: str, rows: tuple[Row, ...] = FRAME, *, fields: bool = True) -> str:
    """The audit as a Markdown table in ``en`` or ``zh``, for the README of the page."""
    en = lang == "en"
    head = ["Key", "Mark"] + (["Fields"] if fields else []) + ["Why"]
    if not en:
        head = ["键", "标记"] + (["字段"] if fields else []) + ["原因"]
    out = [f"| {' | '.join(head)} |", "|" + "---|" * len(head)]
    for entry in rows:
        cells = [f"`{entry.path}`", entry.mark]
        if fields:
            names = ", ".join(f"`{name}`" for name in entry.fields)
            cells.append(names or ("all" if en else "全部"))
        cells.append(entry.en if en else entry.zh)
        out.append(f"| {' | '.join(cells)} |")
    return "\n".join(out)
