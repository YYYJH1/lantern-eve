import hashlib

import pytest

from lantern_core import canon


def test_bytes_are_sorted_compact_utf8():
    assert canon.dumps({"b": 1, "a": ["灯", None, True]}) == '{"a":["灯",null,true],"b":1}'.encode()


def test_digest_is_sha256_of_the_bytes():
    value = {"tick": 3, "who": "李老太"}
    assert canon.digest(value) == hashlib.sha256(canon.dumps(value)).hexdigest()


def test_key_order_does_not_change_the_hash():
    assert canon.digest({"x": 1, "y": 2}) == canon.digest({"y": 2, "x": 1})


@pytest.mark.parametrize(
    "value",
    [1.5, {"a": 0.0}, [float("nan")], {1: "int key"}, {"s": {1, 2}}, 2**53, -(2**53)],
)
def test_values_without_a_canonical_form_are_refused(value):
    with pytest.raises(canon.CanonError):
        canon.dumps(value)


def test_the_largest_safe_ints_pass():
    assert canon.loads(canon.dumps([2**53 - 1, -(2**53 - 1)])) == [2**53 - 1, -(2**53 - 1)]


@pytest.mark.parametrize("text", ["1.0", '{"a": 1e3}', "[NaN]", "Infinity"])
def test_loads_refuses_floats(text):
    with pytest.raises(canon.CanonError):
        canon.loads(text)


def test_error_names_the_path():
    with pytest.raises(canon.CanonError, match=r"\$\.npcs\[1\]\.x"):
        canon.check({"npcs": [{"x": 1}, {"x": 0.5}]})


class Word(str):
    """A subclass of str: canonical, but not at a glance."""


class Count(int):
    pass


GOOD = [
    None,
    True,
    "灯",
    0,
    2**53 - 1,
    -(2**53 - 1),
    [],
    {},
    [1, [2, [3, {"a": [None, "x"]}]]],
    {"b": {"c": [True, False]}, "a": 0},
    (1, 2),  # a tuple is a list for the check
    Word("w"),
    Count(5),
    {"k": Word("w"), "n": Count(5)},
    [Word("w"), {"x": (Count(2),)}],
]
BAD = [
    1.5,
    float("nan"),
    {1: "int key"},
    {"s": {1, 2}},
    2**53,
    -(2**53),
    [0, [1, {"a": [2, 0.5]}]],
    {"a": {"b": {"c": b"bytes"}}},
    Count(2**53),
    [Word("w"), 1.0],
    {Word("k"): 1, 2: 3},
    object(),
]


@pytest.mark.parametrize("value", GOOD)
def test_what_is_canonical_passes_the_quick_look_or_the_careful_one(value):
    canon.check(value)
    canon.careful(value)
    assert canon.plain(value) or isinstance(value, (Word, Count, list, dict, tuple))


@pytest.mark.parametrize("value", BAD)
def test_what_is_not_canonical_is_refused_with_the_same_words_by_both(value):
    assert not canon.plain(value)
    with pytest.raises(canon.CanonError) as quick:
        canon.check(value)
    with pytest.raises(canon.CanonError) as careful:
        canon.careful(value)
    assert str(quick.value) == str(careful.value)


def test_the_quick_look_passes_only_what_the_careful_one_passes():
    for value in (*GOOD, *BAD):
        if canon.plain(value):
            canon.careful(value)  # it would raise


def test_the_quick_look_does_not_take_a_subclass_for_the_type_itself():
    assert not canon.plain(Word("w")) and not canon.plain([Count(1)])
    assert canon.plain("w") and canon.plain([1, True, None])
