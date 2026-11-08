"""The marks of the notebook: what its entries show of how they stand to each other.

An entry shows a mark only for a relation the manager has judged right (the action ``judge``, see
``judge``) or one that the script shows from the start (``tutorial_relations``, the tutorial's
demonstration). Nothing is marked by the game on its own: the notebook does not tell the manager how
their notes stand until they have seen it themselves.

A relation is between two entries, ``a`` the evidence and ``b`` the claim, and it is shown on the
claim: ``unsupported`` (the claim goes beyond the evidence) and ``mismatch`` (the claim is not what
its source said) on ``b``, and ``contradicts`` (they cannot both be true) on both. The words are
those of the page for its marks (``web/src/page/notebook.ts``): ``contradicts``, ``unsupported`` and
``sourceMismatch``, in this order.

This module reads only plain values, so that the notebook can use it without a cycle.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

RELATIONS = ("unsupported", "contradicts", "mismatch")
MARK_OF = {"contradicts": "contradicts", "unsupported": "unsupported", "mismatch": "sourceMismatch"}
ORDER = ("contradicts", "unsupported", "sourceMismatch")


def of_entries(
    entries: Iterable[tuple[str, str]],
    judgments: Sequence[Sequence[Any]],
    tutorial: Sequence[dict[str, Any]],
) -> dict[str, list[str]]:
    """The marks of each entry: ``{entry id: [mark, ...]}`` in the order of ``ORDER``.

    ``entries`` are ``(entry id, prop id)`` in the order of the notebook, ``judgments`` the rows
    ``[a, b, relation, tick]`` the manager made, and ``tutorial`` the relations of the script, each
    ``{"a": [prop], "b": [prop], "relation": relation}``.
    """
    held = list(entries)
    shown: dict[str, set[str]] = {entry_id: set() for entry_id, _ in held}

    def show(a: str, b: str, relation: str) -> None:
        if relation == "contradicts":
            shown[a].add("contradicts")
            shown[b].add("contradicts")
        else:
            shown[b].add(MARK_OF[relation])

    for a, b, relation, *_ in judgments:
        if a in shown and b in shown:
            show(a, b, relation)
    for rule in tutorial:
        for a_id, a_prop in held:
            if a_prop not in rule["a"]:
                continue
            for b_id, b_prop in held:
                if b_prop in rule["b"] and b_id != a_id:
                    show(a_id, b_id, rule["relation"])
    return {
        entry_id: [mark for mark in ORDER if mark in found] for entry_id, found in shown.items()
    }
