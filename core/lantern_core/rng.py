"""PCG32 on plain Python ints: the only source of randomness in the core.

This is the XSH-RR 64/32 generator of M. E. O'Neill's reference implementation (pcg-random.org),
with a 64-bit state and an odd 64-bit increment, seeded exactly like ``pcg32_srandom_r(initstate,
initseq)``. Every operation is integer arithmetic masked to 64 bits, so CPython and Pyodide
produce the same stream, and nothing here touches ``random``, the clock or the operating system.

The generator state serializes as two 16-digit lowercase hex strings. A 64-bit value never
passes through a JavaScript number, which rounds above 2**53, so snapshots and replays can cross
the browser boundary unchanged.

Sampling is integer only:

- ``below(n)`` is unbiased. It rejects the draws below ``2**32 % n`` (``2**64 % n`` for bounds
  above 32 bits, drawing two outputs, high word first) and reduces the rest modulo ``n``. This
  is ``pcg32_boundedrand_r`` of the reference, extended to wider bounds the same way. A draw is
  consumed even when ``n`` is 1.
- ``shuffle`` is the Fisher-Yates shuffle that walks from the end and swaps with ``below(i + 1)``.
- ``weighted`` picks an index with probability ``weight / sum(weights)``, from one ``below``.
"""

from __future__ import annotations

from collections.abc import MutableSequence, Sequence
from typing import Any

MASK32 = 0xFFFFFFFF
MASK64 = 0xFFFFFFFFFFFFFFFF
_MULTIPLIER = 6364136223846793005
_MAX_BOUND = 2**53  # results stay below 2**53, so every one is a canonical int
_HEX = "0123456789abcdef"


class Pcg32:
    """A PCG32 generator whose whole state is two 64-bit ints."""

    __slots__ = ("inc", "state")

    def __init__(self, initstate: int, initseq: int) -> None:
        """Seed like ``pcg32_srandom_r``. Both arguments are taken modulo 2**64."""
        self.state = 0
        self.inc = ((initseq << 1) | 1) & MASK64
        self.next_u32()
        self.state = (self.state + initstate) & MASK64
        self.next_u32()

    def next_u32(self) -> int:
        """The next 32-bit output (``pcg32_random_r``)."""
        old = self.state
        self.state = (old * _MULTIPLIER + self.inc) & MASK64
        xorshifted = (((old >> 18) ^ old) >> 27) & MASK32
        rot = old >> 59
        return ((xorshifted >> rot) | (xorshifted << ((-rot) & 31))) & MASK32

    def below(self, n: int) -> int:
        """An unbiased integer in ``range(n)``, for ``1 <= n <= 2**53``."""
        if type(n) is not int or not 1 <= n <= _MAX_BOUND:
            raise ValueError(f"bound must be an int in [1, 2**53], got {n!r}")
        if n <= MASK32:
            threshold = (2**32 - n) % n
            while True:
                r = self.next_u32()
                if r >= threshold:
                    return r % n
        threshold = (2**64 - n) % n
        while True:
            r = (self.next_u32() << 32) | self.next_u32()
            if r >= threshold:
                return r % n

    def chance(self, numerator: int, denominator: int) -> bool:
        """True with probability ``numerator / denominator``, from one ``below(denominator)``."""
        return self.below(denominator) < numerator

    def choice(self, items: Sequence[Any]) -> Any:
        """One item of a non-empty sequence, uniformly."""
        if not items:
            raise ValueError("choice from an empty sequence")
        return items[self.below(len(items))]

    def shuffle(self, items: MutableSequence[Any]) -> None:
        """Shuffle in place: Fisher-Yates from the end, each swap partner drawn by ``below``."""
        for i in range(len(items) - 1, 0, -1):
            j = self.below(i + 1)
            items[i], items[j] = items[j], items[i]

    def weighted(self, weights: Sequence[int]) -> int:
        """An index drawn with probability ``weights[i] / sum(weights)``.

        Weights are non-negative ints with a positive sum. A zero weight is never drawn.
        """
        total = 0
        for w in weights:
            if type(w) is not int or w < 0:
                raise ValueError(f"weights must be non-negative ints, got {w!r}")
            total += w
        if total <= 0:
            raise ValueError("weights must have a positive sum")
        r = self.below(total)
        for i, w in enumerate(weights):
            if r < w:
                return i
            r -= w
        raise AssertionError("unreachable: r < total")

    def to_state(self) -> dict[str, str]:
        """The state as ``{"state": hex16, "inc": hex16}``."""
        return {"state": f"{self.state:016x}", "inc": f"{self.inc:016x}"}

    @classmethod
    def from_state(cls, data: dict[str, str]) -> Pcg32:
        """Rebuild a generator from ``to_state`` output. Anything else is an error."""
        if not isinstance(data, dict) or sorted(data) != ["inc", "state"]:
            raise ValueError("rng state must be an object with exactly 'state' and 'inc'")
        state, inc = _parse_hex64(data["state"]), _parse_hex64(data["inc"])
        if inc & 1 == 0:
            raise ValueError("rng increment must be odd")
        rng = cls.__new__(cls)
        rng.state = state
        rng.inc = inc
        return rng


def _parse_hex64(text: Any) -> int:
    if not isinstance(text, str) or len(text) != 16 or not all(c in _HEX for c in text):
        raise ValueError(f"expected 16 lowercase hex digits, got {text!r}")
    return int(text, 16)
