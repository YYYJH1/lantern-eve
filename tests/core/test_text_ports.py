"""Tests for the ported text helpers (jsonish and amounts).

Ported from auction-night (MIT, by the same author), tests/llm/test_llm_parse.py: the tests that
touch only these two modules, verbatim apart from imports. The rest of that file drives
auction-night's parsing ladder and stays there. ``test_syntax_repairs_are_named`` reads the
same spellings as that file's test of the same name, but through ``read_object`` directly
rather than through ``parse_reply``.
"""

import json
from decimal import Decimal
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from lantern_core.text.amounts import amount_from_text, chinese_to_int
from lantern_core.text.jsonish import LenientReader, read_object

# --------------------------------------------------------------------- the readers


@st.composite
def json_values(draw: st.DrawFn) -> Any:
    scalars = st.none() | st.booleans() | st.integers(-(10**12), 10**12) | st.text(max_size=20)
    scalars |= st.floats(allow_nan=False, allow_infinity=False)
    return draw(
        st.recursive(
            scalars,
            lambda children: (
                st.lists(children, max_size=4)
                | st.dictionaries(st.text(max_size=8), children, max_size=4)
            ),
            max_leaves=12,
        )
    )


@settings(max_examples=300, deadline=None)
@given(
    value=st.dictionaries(st.text(max_size=8), json_values(), max_size=5), ascii_only=st.booleans()
)
def test_valid_json_reads_as_json_with_no_repairs(value: dict[str, Any], ascii_only: bool) -> None:
    text = json.dumps(value, ensure_ascii=ascii_only)
    obj, end, fixes = read_object(text, 0)
    assert (obj, end, fixes) == (value, len(text), ())
    lenient = LenientReader(text, 0)
    assert lenient.value(0) == value and lenient.fixes == []


def test_read_object_reports_what_it_had_to_fix() -> None:
    obj, end, fixes = read_object("前缀 {'a': 1,} 后缀", 3)
    assert obj == {"a": 1} and fixes == ("single_quotes", "trailing_comma")
    assert "后缀" in "前缀 {'a': 1,} 后缀"[end:]
    with pytest.raises(ValueError, match="colon"):
        read_object('{"a" 1}', 0)
    with pytest.raises(ValueError, match="not an object"):
        read_object("[1]", 0)


# Spellings of one object that models write, from auction-night's tests/llm/llm_replies.py.
SPELLINGS = {
    "fullwidth": '｛"phase"：“sealed”，"bid"：１２０，"thought"：“按估值出价。”｝',
    "fullwidth_braces_only": '｛"phase": "sealed", "bid": 120, "thought": "按估值出价。"｝',
    "smart_quotes": "{“phase”: “sealed”, “bid”: 120, “thought”: “按估值出价。”}",
    "single_quotes": "{'phase': 'sealed', 'bid': 120, 'thought': '按估值出价。'}",
    "trailing_comma": '{"phase": "sealed", "bid": 120, "thought": "按估值出价。",}',
    "missing_closing_brace": '{"phase": "sealed", "bid": 120, "thought": "按估值出价。"',
    "missing_closing_quote_and_brace": '{"phase": "sealed", "bid": 120, "thought": "按估值出价。',
    "unquoted_keys": '{phase: "sealed", bid: 120, thought: "按估值出价。"}',
    "python_literals": '{"phase": "sealed", "bid": 120, "thought": "按估值出价。", "note": None}',
    "line_comment": '{"phase": "sealed", // 阶段\n "bid": 120, "thought": "按估值出价。"}',
    "equals_instead_of_colon": '{"phase"="sealed", "bid"=120, "thought"="按估值出价。"}',
    "inner_quotes": '{"phase": "sealed", "bid": 120, "thought": "他说"便宜"，我信了"}',
    "bare_unit_value": '{"phase": "sealed", "bid": 120金币, "thought": "按估值出价。"}',
}


@pytest.mark.parametrize(
    ("name", "fixes"),
    [
        ("fullwidth", {"fullwidth", "smart_quotes"}),
        ("fullwidth_braces_only", {"fullwidth"}),
        ("smart_quotes", {"smart_quotes"}),
        ("single_quotes", {"single_quotes"}),
        ("trailing_comma", {"trailing_comma"}),
        ("missing_closing_brace", {"unclosed"}),
        ("missing_closing_quote_and_brace", {"unclosed"}),
        ("unquoted_keys", {"unquoted"}),
        ("python_literals", {"python_literal"}),
        ("line_comment", {"comment"}),
        ("equals_instead_of_colon", {"equals_colon"}),
        ("inner_quotes", {"stray_quote"}),
        ("bare_unit_value", {"bare_value"}),
    ],
)
def test_syntax_repairs_are_named(name: str, fixes: set[str]) -> None:
    obj, _, found = read_object(SPELLINGS[name], 0)
    assert set(found) == fixes
    assert obj["phase"] == "sealed"


# ------------------------------------------------------------------------- numbers


def chinese(n: int) -> str:
    """Reference rendering of 0..99999 in Chinese numerals, for the round trip."""
    digits = "零一二三四五六七八九"
    if n == 0:
        return "零"

    def under_10000(m: int, lead_zero: bool) -> str:
        parts = []
        for unit, name in ((1000, "千"), (100, "百"), (10, "十"), (1, "")):
            d = m // unit % 10
            if d:
                if unit == 10 and d == 1 and m < 20 and not lead_zero:
                    parts.append("十")
                else:
                    parts.append(digits[d] + name)
            elif parts and m % unit and not parts[-1].endswith("零"):
                parts.append("零")
        return "".join(parts)

    high, low = divmod(n, 10000)
    text = under_10000(high, False) + "万" if high else ""
    if low:
        if high and low < 1000:
            text += "零"
        text += under_10000(low, bool(high))
    return text


@pytest.mark.parametrize(
    ("text", "number"),
    [
        ("零", 0),
        ("十", 10),
        ("十五", 15),
        ("二十", 20),
        ("二十五", 25),
        ("一百", 100),
        ("一百零五", 105),
        ("一百一十", 110),
        ("一百二十", 120),
        ("一百二", 120),
        ("两百", 200),
        ("二百五", 250),
        ("三千五", 3500),
        ("一千零一十", 1010),
        ("一千零五", 1005),
        ("两万三", 23000),
        ("三万五千", 35000),
        ("一亿二千万", 120_000_000),
        ("二〇二六", 2026),
        ("一二零", 120),
        ("壹佰贰拾", 120),
        ("负五十", -50),
    ],
)
def test_chinese_numerals(text: str, number: int) -> None:
    assert chinese_to_int(text) == number


@pytest.mark.parametrize("text", ["", "百", "万", "一百百", "十五元", "abc", "一点五", "一 二"])
def test_not_a_chinese_numeral(text: str) -> None:
    assert chinese_to_int(text) is None


def test_chinese_numerals_round_trip() -> None:
    for number in range(100_000):
        assert chinese_to_int(chinese(number)) == number, (number, chinese(number))


@pytest.mark.parametrize(
    ("text", "number"),
    [
        ("120", 120),
        (" 120 ", 120),
        ("+120", 120),
        ("-5", -5),
        ("1,200", 1200),
        ("120.7", 120),
        ("１２０", 120),
        ("120 金币", 120),
        ("120金币", 120),
        ("120 coins", 120),
        ("120块", 120),
        ("¥120", 120),
        ("￥120", 120),
        ("$99", 99),
        ("约 120", 120),
        ("大约一百二十", 120),
        ("出价 150", 150),
        ("120左右", 120),
        ("120。", 120),
        ("「120」", 120),
        ("1.5万", 15000),
        ("3k", 3000),
        ("一百二十金币", 120),
        ("等", 0),
        ("不出", 0),
        ("False", 0),
    ],
)
def test_amount_text(text: str, number: int) -> None:
    assert amount_from_text(text) == number


@pytest.mark.parametrize(
    "text",
    ["", "抢", "是", "true", "很多", "abc", "100到120", "100 或 120", "1,2", "NaN", "inf", "1e3x"],
)
def test_amount_text_without_a_number(text: str) -> None:
    assert amount_from_text(text) is None


@settings(max_examples=200, deadline=None)
@given(number=st.integers(min_value=0, max_value=10**9))
def test_amounts_round_trip_through_their_spellings(number: int) -> None:
    assert amount_from_text(str(number)) == number
    assert amount_from_text(f"{number} 金币") == number
    assert amount_from_text(f"{number:,}") == number
    assert amount_from_text(f"¥{number}") == number
    assert amount_from_text(str(Decimal(number) + Decimal("0.99"))) == number
