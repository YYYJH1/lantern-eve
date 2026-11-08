"""PCG32 against the C reference implementation.

The known answers below were produced by compiling ``C_REFERENCE`` with gcc. A second test
compiles it again, when gcc is on the PATH, and compares thousands of draws for several seeds.
"""

import shutil
import subprocess

import pytest

from lantern_core.rng import Pcg32

C_REFERENCE = r"""
/* Reference PCG32 (XSH-RR 64/32) after the minimal C implementation by M. E. O'Neill
 * (pcg-random.org). It is the oracle for core/lantern_core/rng.py.
 *
 *   pcg32_ref raw      <initstate> <initseq> <count>
 *   pcg32_ref below    <initstate> <initseq> <count> <bound>
 *   pcg32_ref shuffle  <initstate> <initseq> <n>
 *   pcg32_ref weighted <initstate> <initseq> <count> <w0> <w1> ...
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { uint64_t state; uint64_t inc; } pcg32_random_t;

static uint32_t pcg32_random_r(pcg32_random_t *rng) {
    uint64_t oldstate = rng->state;
    rng->state = oldstate * 6364136223846793005ULL + (rng->inc | 1);
    uint32_t xorshifted = (uint32_t)(((oldstate >> 18u) ^ oldstate) >> 27u);
    uint32_t rot = (uint32_t)(oldstate >> 59u);
    return (xorshifted >> rot) | (xorshifted << ((-rot) & 31));
}

static void pcg32_srandom_r(pcg32_random_t *rng, uint64_t initstate, uint64_t initseq) {
    rng->state = 0U;
    rng->inc = (initseq << 1u) | 1u;
    pcg32_random_r(rng);
    rng->state += initstate;
    pcg32_random_r(rng);
}

static uint64_t bounded(pcg32_random_t *rng, uint64_t bound) {
    if (bound <= 0xffffffffULL) {
        uint32_t b = (uint32_t)bound, threshold = -b % b;
        for (;;) {
            uint32_t r = pcg32_random_r(rng);
            if (r >= threshold) return r % b;
        }
    }
    uint64_t threshold = -bound % bound;
    for (;;) {
        uint64_t hi = pcg32_random_r(rng);
        uint64_t lo = pcg32_random_r(rng);
        uint64_t r = (hi << 32) | lo;
        if (r >= threshold) return r % bound;
    }
}

int main(int argc, char **argv) {
    pcg32_random_t rng;
    if (argc < 5) return 2;
    pcg32_srandom_r(&rng, strtoull(argv[2], NULL, 0), strtoull(argv[3], NULL, 0));
    int count = atoi(argv[4]);
    if (!strcmp(argv[1], "raw")) {
        for (int i = 0; i < count; i++) printf("%u\n", pcg32_random_r(&rng));
    } else if (!strcmp(argv[1], "below")) {
        uint64_t bound = strtoull(argv[5], NULL, 0);
        for (int i = 0; i < count; i++) printf("%llu\n", (unsigned long long)bounded(&rng, bound));
    } else if (!strcmp(argv[1], "shuffle")) {
        int a[1024];
        for (int i = 0; i < count; i++) a[i] = i;
        for (int i = count - 1; i > 0; i--) {
            int j = (int)bounded(&rng, (uint64_t)i + 1), t = a[i];
            a[i] = a[j]; a[j] = t;
        }
        for (int i = 0; i < count; i++) printf("%d\n", a[i]);
    } else if (!strcmp(argv[1], "weighted")) {
        int k = argc - 5;
        uint64_t total = 0, w[64];
        for (int i = 0; i < k; i++) { w[i] = strtoull(argv[5 + i], NULL, 0); total += w[i]; }
        for (int n = 0; n < count; n++) {
            uint64_t r = bounded(&rng, total);
            int i = 0;
            while (r >= w[i]) { r -= w[i]; i++; }
            printf("%d\n", i);
        }
    }
    printf("end %016llx %016llx\n", (unsigned long long)rng.state, (unsigned long long)rng.inc);
    return 0;
}
"""


def test_first_outputs_for_seed_42_54_match_the_reference():
    rng = Pcg32(42, 54)
    assert [rng.next_u32() for _ in range(6)] == [
        0xA15C02B7,
        0x7B47F409,
        0xBA1D3330,
        0x83D2F293,
        0xBFA4784B,
        0xCBED606E,
    ]


def test_seeding_follows_pcg32_srandom_r():
    rng = Pcg32(42, 54)
    assert (rng.state, rng.inc) == (0x185706B82C2E03F8, 54 * 2 + 1)
    assert Pcg32(0, 0).inc == 1


@pytest.mark.parametrize(
    ("initstate", "initseq", "expected"),
    [
        (0, 0, [3837872008, 932996374, 1548399547, 1612522464]),
        (2**64 - 1, 2**64 - 1, [645251143, 2004461623, 2705697299, 1600907046]),
    ],
)
def test_seed_extremes_match_the_reference(initstate, initseq, expected):
    rng = Pcg32(initstate, initseq)
    assert [rng.next_u32() for _ in range(4)] == expected


def test_a_thousand_draws_end_in_the_reference_state():
    rng = Pcg32(42, 54)
    for _ in range(1000):
        rng.next_u32()
    assert (rng.state, rng.inc) == (0x77D57A2A8F8FC510, 0x6D)


@pytest.mark.parametrize(
    ("initstate", "initseq", "bound", "expected"),
    [
        (42, 54, 6, [3, 3, 2, 1, 1]),
        (42, 54, 1, [0, 0, 0, 0]),
        (12345, 1, 1_000_000_007, [280515110, 875822104, 165131989, 444695155]),
        # 32-bit bounds take one output per draw, wider bounds take two (high word first).
        (42, 54, 2**32, [2068313097, 2211639955, 3421331566, 2167406445]),
        (42, 54, 2**32 + 1, [3656118611, 3384131428, 206104611, 3244907457]),
        (7, 3, 2**53, [7642858834102044, 2156264905873154, 2066716839293487]),
        (7, 3, 2**53 - 1, [7642858834103799, 2156264905873943, 2066716839294339]),
    ],
)
def test_below_matches_the_reference(initstate, initseq, bound, expected):
    rng = Pcg32(initstate, initseq)
    assert [rng.below(bound) for _ in expected] == expected


def test_shuffle_matches_the_reference():
    items = list(range(10))
    Pcg32(42, 54).shuffle(items)
    assert items == [8, 2, 6, 4, 5, 1, 7, 0, 9, 3]


def test_weighted_matches_the_reference():
    rng = Pcg32(1, 2)
    assert [rng.weighted([3, 1, 0, 5]) for _ in range(8)] == [0, 3, 3, 3, 3, 3, 3, 3]
    rng = Pcg32(99, 7)
    assert [rng.weighted([2, 2, 2]) for _ in range(6)] == [2, 2, 2, 2, 1, 1]


class _Scripted(Pcg32):
    """A generator that returns scripted outputs, to reach the rejection branches."""

    def __init__(self, outputs):
        self.state = 0
        self.inc = 1
        self.outputs = list(outputs)

    def next_u32(self):
        return self.outputs.pop(0)


def test_below_rejects_the_draws_that_would_bias_the_result():
    # 2**32 % 3 == 1, so an output of 0 is rejected and 1 is the first one that is kept.
    assert _Scripted([0, 1]).below(3) == 1
    assert _Scripted([0, 0, 4294967295]).below(3) == 0
    # 2**32 % 2**31 == 0, so nothing is rejected.
    assert _Scripted([0]).below(2**31) == 0
    # Wide bounds draw two outputs per attempt and reject on the 64-bit value.
    n = 2**40 + 1
    threshold = (2**64) % n
    assert threshold > 0
    low = (threshold - 1) >> 32, (threshold - 1) & 0xFFFFFFFF
    kept = (threshold >> 32, threshold & 0xFFFFFFFF)
    assert _Scripted([*low, *kept]).below(n) == threshold % n


def test_below_is_roughly_uniform():
    rng = Pcg32(2024, 1)
    counts = [0] * 6
    for _ in range(60_000):
        counts[rng.below(6)] += 1
    assert all(9_500 <= c <= 10_500 for c in counts), counts


@pytest.mark.parametrize("bad", [0, -1, 2**53 + 1, 1.5, True, "3", None])
def test_below_refuses_bad_bounds(bad):
    with pytest.raises(ValueError):
        Pcg32(1, 1).below(bad)


def test_choice_chance_and_the_empty_cases():
    rng = Pcg32(5, 5)
    assert rng.choice("abc") in "abc"
    with pytest.raises(ValueError):
        rng.choice([])
    draws = [Pcg32(8, 8).chance(1, 1) for _ in range(3)]
    assert draws == [True, True, True]
    assert not Pcg32(8, 8).chance(0, 5)


def test_shuffle_is_a_permutation_and_handles_short_lists():
    rng = Pcg32(3, 3)
    for n in range(0, 12):
        items = list(range(n))
        rng.shuffle(items)
        assert sorted(items) == list(range(n))


@pytest.mark.parametrize("bad", [[], [0, 0], [1, -1], [1, 1.5], [True, 1]])
def test_weighted_refuses_bad_weights(bad):
    # A bool is an int subclass, but a weight must be a plain int.
    with pytest.raises(ValueError):
        Pcg32(1, 1).weighted(bad)


def test_a_zero_weight_is_never_drawn():
    rng = Pcg32(11, 4)
    assert {rng.weighted([0, 3, 0, 1]) for _ in range(500)} == {1, 3}


def test_state_serializes_as_sixteen_hex_digits():
    rng = Pcg32(42, 54)
    assert rng.to_state() == {"state": "185706b82c2e03f8", "inc": "000000000000006d"}
    clone = Pcg32.from_state(rng.to_state())
    assert [clone.next_u32() for _ in range(5)] == [rng.next_u32() for _ in range(5)]


@pytest.mark.parametrize(
    "bad",
    [
        {"state": "185706b82c2e03f8"},
        {"state": "185706b82c2e03f8", "inc": "000000000000006d", "extra": "0"},
        {"state": "185706B82C2E03F8", "inc": "000000000000006d"},
        {"state": "185706b82c2e03f", "inc": "000000000000006d"},
        {"state": "185706b82c2e03f8", "inc": "000000000000006c"},
        {"state": 1, "inc": "000000000000006d"},
        {"state": "0x5706b82c2e03f8", "inc": "000000000000006d"},
        [],
    ],
)
def test_from_state_refuses_malformed_state(bad):
    with pytest.raises(ValueError):
        Pcg32.from_state(bad)


@pytest.fixture(scope="module")
def c_oracle(tmp_path_factory):
    gcc = shutil.which("gcc")
    if gcc is None:
        pytest.skip("gcc is not installed, so the live comparison with the C reference is skipped")
    directory = tmp_path_factory.mktemp("pcg32_c")
    source = directory / "pcg32_ref.c"
    source.write_text(C_REFERENCE, encoding="utf-8")
    binary = directory / "pcg32_ref"
    subprocess.run([gcc, "-O2", "-o", str(binary), str(source)], check=True)

    def run(*args):
        out = subprocess.run(
            [str(binary), *map(str, args)], check=True, capture_output=True, text=True
        ).stdout
        *lines, last = out.split("\n")[:-1]
        assert last.startswith("end ")
        _, state, inc = last.split()
        return [int(x) for x in lines], (int(state, 16), int(inc, 16))

    return run


SEEDS = [(0, 0), (42, 54), (1, 2**63), (2**64 - 1, 5), (123456789, 987654321)]


@pytest.mark.parametrize(("initstate", "initseq"), SEEDS)
def test_raw_outputs_agree_with_gcc(c_oracle, initstate, initseq):
    expected, end = c_oracle("raw", initstate, initseq, 5000)
    rng = Pcg32(initstate, initseq)
    assert [rng.next_u32() for _ in range(5000)] == expected
    assert (rng.state, rng.inc) == end


@pytest.mark.parametrize(("initstate", "initseq"), SEEDS)
@pytest.mark.parametrize("bound", [1, 2, 3, 6, 10, 1000, 65537, 2**31 + 7, 2**32 - 1, 2**32])
def test_below_agrees_with_gcc(c_oracle, initstate, initseq, bound):
    expected, end = c_oracle("below", initstate, initseq, 1000, bound)
    rng = Pcg32(initstate, initseq)
    assert [rng.below(bound) for _ in range(1000)] == expected
    assert (rng.state, rng.inc) == end


@pytest.mark.parametrize("bound", [2**32 + 1, 10**12 + 39, 2**52 + 11, 2**53 - 1, 2**53])
def test_wide_below_agrees_with_gcc(c_oracle, bound):
    expected, end = c_oracle("below", 77, 88, 500, bound)
    rng = Pcg32(77, 88)
    assert [rng.below(bound) for _ in range(500)] == expected
    assert (rng.state, rng.inc) == end


@pytest.mark.parametrize("n", [1, 2, 7, 52, 500])
def test_shuffle_agrees_with_gcc(c_oracle, n):
    expected, end = c_oracle("shuffle", 2026, 11, n)
    items = list(range(n))
    rng = Pcg32(2026, 11)
    rng.shuffle(items)
    assert items == expected
    assert (rng.state, rng.inc) == end


@pytest.mark.parametrize("weights", [[1], [3, 1, 0, 5], [1, 1, 1, 1, 1, 1, 1], [100, 0, 1]])
def test_weighted_agrees_with_gcc(c_oracle, weights):
    expected, end = c_oracle("weighted", 31, 41, 400, *weights)
    rng = Pcg32(31, 41)
    assert [rng.weighted(weights) for _ in range(400)] == expected
    assert (rng.state, rng.inc) == end
