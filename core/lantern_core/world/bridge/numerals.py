"""The numbers of the town, said as the town says them.

In Chinese a quantity of the town is said in characters before its measure word: 十根竹料, 五位,
两个早上, 已做十二个钟头. A clock time (07:00), a score on a scale (the grudge: 39点) and a number
that follows a strike line on the page keep their digits, and so does every number in English.
``zh_count`` is the one place that says a count in characters. The words of a task
(``agenda_facts.fill``) and everything else the core writes in Chinese (``commitments.fill`` for
the recap, the paper and the lines of the townsfolk, and the previews, the offers and the board)
call it, so that the page has nothing to convert.

A module of its own, with no import, because the words of the commitments and the words of the
tasks both need it and the second reads the first.
"""

from __future__ import annotations

DIGITS = "零一二三四五六七八九"
LARGEST = 99  # past it a count keeps its digits


def zh_count(number: int) -> str:
    """A count as the town says it in characters, before a measure word: 四, 两 (for two), 十,
    十二, 二十五. A number that is not from 0 to 99 keeps its digits."""
    if not 0 <= number <= LARGEST:
        return str(number)
    if number == 2:
        return "两"
    tens, ones = divmod(number, 10)
    if tens == 0:
        return DIGITS[ones]
    return f"{'' if tens == 1 else DIGITS[tens]}十{DIGITS[ones] if ones else ''}"


def zh_ordinal(number: int) -> str:
    """The number of a place in a row, as in 第一位 and 第二日: 二 for two, else a count."""
    return "二" if number == 2 else zh_count(number)


def zh_share(percent: int) -> str:
    """A share in tenths, as a person would say it: 六成 for 60. A share that is not a whole number
    of tenths between one and nine is the percent, in digits."""
    if percent % 10 or not 0 < percent < 100:
        return f"{percent}%"
    return f"{DIGITS[percent // 10]}成"


def count_words(number: int) -> dict[str, str]:
    """A count in both languages: characters in Chinese, digits in English."""
    return {"zh": zh_count(number), "en": str(number)}
