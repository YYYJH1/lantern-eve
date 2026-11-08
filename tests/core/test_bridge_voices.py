"""The voices of the townsfolk: each person says the fixed words of the town in their own way.

The way is chosen by the person, the kind of line and a tick, with integers only. These tests hold
that choice to what it promises: it is the same every time and in every host, it uses every
variant, a bubble keeps its words while it is on show, and the state never knows the voices are
there. Then they ask the twenty people the same four things, one after the other, and listen to
what each of them says.
"""

import copy
import json

import bridge_driver
import pytest
from bridge_helpers import state_of, step
from dealings_helpers import acks, act, believe, events, know, me, talking, tell, told_event, trust
from voice_helpers import VOICED, bubble, claim_wordings

from lantern_core.api import Game
from lantern_core.cognition.lines import frame_key
from lantern_core.world.bridge import phrases, player, social, voices
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.voice_data import VOICES

LO = lore()
CODES = sorted(phrases.PHRASES)
FRAMES = ("seen", "heard", "unknown", "own", "guess_own", "guess_heard", "guess_unknown")
# when each is awake and within reach, and has most of an hour before the routine calls them (a
# conversation ends when it does, and the first act of the test takes ten minutes)
HOURS = {
    "zhou_dalang": 11,
    "gengfu": 16,
    "xiao_man": 11,
    "shitou": 9,
    "sishu_xiansheng": 10,
    "zuzhang": 9,
    "zhangfang": 9,
    "miaozhu": 9,
}
NOBODY_KNOWS = "t_honor_light"  # a thing that no townsperson holds anything about
HUB = "cha_laoban"  # whom they send the manager to, and who can send no one else


def pointing(who: str) -> str:
    """The code of what a person says to a question they know nothing of: they name the hub, and
    the hub herself says that she does not know."""
    return "unknown" if who == HUB else "point_hub"


def ways(who: str, code: str) -> list[dict[str, str]]:
    """The ways a person says a fixed line, with the hub named in the lines that point to her."""
    found = voices.variants(who, code)
    return [phrases.named(w, lore().names[HUB]) for w in found] if code == "point_hub" else found


# ------------------------------------------------------------------------------ the choice


def test_the_mix_is_a_fixed_function_of_three_integers():
    # the same numbers in every host and every process: no hash() of a string, no RNG
    assert voices.mix("li_laotai", "line:unknown", 0) == 42475618
    assert voices.mix("cha_laoban", "line:unknown", 0) == 2454150170
    assert voices.mix("old_he", "line:busy", 1234) == 1308056160
    assert voices.mix("zuzhang", "line:elder_yes", 9999) == 132457714
    assert voices.mix("xiao_man", "frame:seen", 70) == 2920066377
    assert voices.mix("zhangfang", "frame:guess_heard", 10350) == 3633817707
    assert [voices.choose("xiao_man", "frame:seen", 70, n) for n in (1, 2, 3, 5, 7)] == [
        0,
        1,
        0,
        2,
        4,
    ]


def test_nothing_but_integers_goes_in_or_comes_out_and_nothing_is_drawn():
    for tick in (0, 1, 59, 2070, 10_349):
        value = voices.mix("gengfu", "line:timeout", tick)
        assert type(value) is int and 0 <= value < 2**32
        assert voices.choose("gengfu", "line:timeout", tick, 2) in (0, 1)
    assert not {"random", "rng", "Pcg32"} & set(vars(voices))  # not a thing the module can reach


def test_the_same_three_things_make_the_same_choice_in_any_order():
    keys = [(p, voices.LINE + c, t) for p in VOICED for c in CODES for t in range(0, 60, 11)]
    forward = {key: voices.choose(*key, 2) for key in keys}
    backward = {key: voices.choose(*key, 2) for key in reversed(keys)}
    assert forward == backward and len(forward) == len(keys)


def test_every_variant_of_every_line_and_frame_of_every_person_is_used():
    for person in VOICED:
        for code in CODES:
            used = {voices.choose(person, voices.LINE + code, t, 2) for t in range(200)}
            assert used == {0, 1}, (person, code)
        for key in FRAMES:
            used = {voices.choose(person, voices.FRAME + key, t, 2) for t in range(200)}
            assert used == {0, 1}, (person, key)


def test_the_two_variants_share_the_ticks_about_evenly():
    counts = [0, 0]
    for person in VOICED:
        for code in CODES:
            for tick in range(0, 400, 3):
                counts[voices.choose(person, voices.LINE + code, tick, 2)] += 1
    assert abs(counts[0] - counts[1]) < sum(counts) // 50  # within two in a hundred


def test_the_choice_changes_with_the_person_with_the_kind_and_with_the_tick():
    by_person = {voices.choose(p, "line:unknown", 100, 2) for p in VOICED}
    by_kind = {voices.choose("li_er", voices.LINE + c, 100, 2) for c in CODES}
    by_tick = {voices.choose("li_er", "line:unknown", t, 2) for t in range(100, 140)}
    assert by_person == by_kind == by_tick == {0, 1}


def test_a_person_without_a_voice_speaks_the_plain_words():
    assert not voices.has_voice("stranger") and voices.has_voice("old_he")
    assert voices.phrase("stranger", "busy", 5) == phrases.phrase("busy")
    assert voices.variants("stranger", "busy") == [phrases.phrase("busy")]
    assert voices.frame("stranger", "seen", 5) is None and voices.hedges("stranger") is None
    with pytest.raises(KeyError):
        voices.phrase("old_he", "no_such_code", 5)
    with pytest.raises(KeyError):
        voices.variants("stranger", "no_such_code")


def test_what_a_person_tells_is_worded_in_their_frame_and_hedged_in_their_words():
    prop = LO.book.props["pr_liner_at_bridge"]
    for person in ("cha_laoban", "old_he", "zuzhang"):
        for pick in (0, 1, 2, 3):
            for source in ("self_seen", "unknown", "zhou_huoji", person):
                for modality in ("assert", "speculate"):
                    said = voices.claim_words(prop, modality, source, person, pick, 77)
                    assert said in claim_wordings(prop, modality, source, person, pick)
    guess = [
        voices.claim_words(prop, "speculate", "self_seen", "cha_laoban", pick, 0) for pick in (0, 1)
    ]
    hedges = VOICES["cha_laoban"]["hedges"]
    assert [hedges["en"][0] in g["en"] for g in guess] == [True, False]
    assert [hedges["en"][1] in g["en"] for g in guess] == [False, True]
    assert frame_key("speculate", "unknown", "x") == "guess_unknown"


# ------------------------------------------------------------------------------ every code, said


@pytest.mark.parametrize("code", CODES)
def test_every_fixed_line_is_made_in_the_voice_of_the_one_who_says_it(code):
    for who in ("cha_laoban", "old_he", "zuzhang", "shitou"):
        seen = set()
        for until in range(100, 140):
            words = voices.phrase(who, code, until)
            assert words in voices.variants(who, code) and words != phrases.phrase(code)
            seen.add(json.dumps(words, sort_keys=True, ensure_ascii=False))
        assert len(seen) == 2  # both of their ways of saying it were used


def test_the_frame_makes_a_line_on_show_from_the_state_alone():
    game = talking("cha_laoban")
    state = state_of(game)
    for code in CODES:
        line = ["cha_laoban", game.tick + 60, "text", code, ""]
        assert player.words(state, line) == voices.phrase("cha_laoban", code, game.tick + 60)
    with pytest.raises(KeyError):
        player.words(state, ["cha_laoban", 5, "text", "no_such_code", ""])


# ------------------------------------------------------------------------------ twenty people


def scene(who: str) -> tuple[Game, str]:
    """``who`` in a conversation with the manager, who has seen a thing that ``who`` has seen too.
    The game and the id of the entry."""
    game = talking(who, hour=HOURS.get(who, 8))
    trust(game, who, 40)
    entry = know(game, "pr_boat_scratched")
    believe(game, who, "pr_boat_scratched", 90, "saw")
    return game, entry["id"]


@pytest.fixture(scope="module")
def heard():
    """``{person: {code: words}}``: what each of the twenty says when the same four things are
    asked, told or left to run out on them."""
    out: dict[str, dict[str, dict[str, str]]] = {}
    for who in VOICED:
        game, entry = scene(who)
        snapshot = game.snapshot_json()
        words: dict[str, dict[str, str]] = {}
        # asked about something that nobody knows anything of
        fork = Game.from_snapshot_json(snapshot)
        result = act(fork, "ask", topic=NOBODY_KNOWS)
        (asked,) = events(result, "asked")
        assert asked["answer"] == "ignorant"
        words[pointing(who)] = bubble(result, who)
        # told what they know already
        fork = Game.from_snapshot_json(snapshot)
        result = tell(fork, entry, "as_seen")
        assert told_event(result)["outcome"] == "knew"
        words["knew"] = bubble(result, who)
        # asked to lend the bamboo: only Granny Li has any to lend, and she has a condition
        fork = Game.from_snapshot_json(snapshot)
        result = act(fork, "entrust", kind="lend")
        assert acks(result)[0][0] == "rejected"
        words["hard_hc_li_bamboo" if who == "li_laotai" else "cannot"] = bubble(result, who)
        # asked until their routine calls them away (the world stands still between the acts)
        fork = Game.from_snapshot_json(snapshot)
        result = act(fork, "ask", topic="p_bridge")
        while not events(result, "talk_end"):
            result = act(fork, "ask", topic="p_bridge") if fork.paused else step(fork)
        words["timeout"] = bubble(result, who)
        out[who] = words
    return out


@pytest.mark.parametrize("who", VOICED)
def test_each_person_says_it_in_a_voice_that_is_theirs_and_not_the_plain_one(who, heard):
    assert set(heard[who]) == {
        pointing(who),
        "knew",
        "timeout",
        "hard_hc_li_bamboo" if who == "li_laotai" else "cannot",
    }
    for code, words in heard[who].items():
        assert words in ways(who, code), (who, code, words)
        plain = phrases.phrase(code)
        if code == "point_hub":
            plain = phrases.named(plain, lore().names[HUB])
        assert words != plain


@pytest.mark.parametrize("code", ["point_hub", "knew", "timeout", "cannot"])
def test_two_people_asked_the_same_thing_answer_in_different_words(code, heard):
    texts = {who: heard[who][code] for who in VOICED if code in heard[who]}
    assert len(texts) >= 19
    for lang in ("zh", "en"):
        said_by: dict[str, list[str]] = {}
        for who, words in texts.items():
            said_by.setdefault(words[lang], []).append(who)
        twins = {text: who for text, who in said_by.items() if len(who) > 1}
        assert not twins, (code, lang, twins)


@pytest.mark.parametrize("who", VOICED)
def test_no_other_voice_has_a_word_of_this_ones_fixed_lines(who):
    mine = {
        (code, lang): {v[lang] for v in VOICES[who]["lines"][code]}
        for code in CODES
        for lang in ("zh", "en")
    }
    for other in VOICED:
        if other == who:
            continue
        for (code, lang), texts in mine.items():
            theirs = {v[lang] for v in VOICES[other]["lines"][code]}
            assert not texts & theirs, (who, other, code, lang)


# ------------------------------------------------------------------------------ the state


def run(ticks: int):
    """The scripted game of the cross-host driver to ``ticks``: the state hash and the outputs of
    every call."""
    driver = bridge_driver.Driver(restores=False)
    hashes, outputs = [], []
    while driver.game.tick < ticks:
        _, out = driver.call()
        hashes.append(driver.game.hash())
        outputs.append(out)
    return hashes, outputs


def unworded(out: dict) -> str:
    """The outputs of a call, without the words of the bubbles."""
    masked = copy.deepcopy(out)
    for shown in masked["frame"]["bubbles"]:
        shown["text"] = None
    return json.dumps(masked, sort_keys=True)


def answers(outputs: list[dict]) -> list[tuple[str, dict[str, str]]]:
    """Who the manager talked to, and the words over their head, in every call of a conversation."""
    return [
        (talk["npc"], b["text"])
        for o in outputs
        if (talk := o["frame"]["player"]["talk"])
        for b in o["frame"]["bubbles"]
        if b["npc"] == talk["npc"]
    ]


def test_the_state_does_not_know_there_are_voices(monkeypatch):
    with monkeypatch.context() as patch:
        patch.setattr(voices, "VOICES", {})  # everyone speaks the plain words again
        voices.claim_words.cache_clear()
        plain_hashes, plain_out = run(900)
    voices.claim_words.cache_clear()
    hashes, out = run(900)
    assert len(hashes) == len(plain_hashes) == 901  # the call that opens a talk simulates no tick
    assert hashes == plain_hashes  # the state is the same after every call
    assert [unworded(o) for o in out] == [unworded(o) for o in plain_out]  # and so is all else
    said = [(b["npc"], b["text"]) for o in out for b in o["frame"]["bubbles"]]
    plain = [(b["npc"], b["text"]) for o in plain_out for b in o["frame"]["bubbles"]]
    assert len(said) == len(plain) > 100 and said != plain  # only the words are not
    assert len(answers(out)) == len(answers(plain_out)) > 20  # the manager was answered in them
    assert answers(out) != answers(plain_out)
    voices.claim_words.cache_clear()


def test_a_bubble_does_not_change_its_words_while_it_is_on_show(monkeypatch):
    """Every line the state holds on show, the manager's partner's or a neighbour's, is worded the
    same in every frame it is in. (The manager hears every telling here: what is out of earshot
    has no words to compare, and a test of the hearing is in ``test_bridge_information``.)"""
    monkeypatch.setattr(social, "near", lambda state, who: True)
    driver = bridge_driver.Driver(restores=False)
    wording: dict[tuple, set[str]] = {}
    while driver.game.tick < 2900:
        _, out = driver.call()
        world, now = state_of(driver.game), driver.game.tick
        shown = {b["npc"]: json.dumps(b["text"], sort_keys=True) for b in out["frame"]["bubbles"]}
        line = world["player"]["line"]
        spoken = bool(line) and line[1] > now
        if spoken:
            wording.setdefault(("player", *line), set()).add(shown[line[0]])
        for npc, until, claim in world["social"]["bubbles"]:
            if until > now and not (spoken and line[0] == npc):
                wording.setdefault(("social", npc, until, claim), set()).add(shown[npc])
    assert sum(1 for key in wording if key[0] == "player") >= 4
    assert sum(1 for key in wording if key[0] == "social") >= 30
    assert {key: texts for key, texts in wording.items() if len(texts) != 1} == {}


def test_the_words_come_from_the_state_so_a_restored_game_says_the_same_things():
    game = talking("zhou_niangzi")
    before = bubble(act(game, "ask", topic=NOBODY_KNOWS), "zhou_niangzi")
    restored = Game.from_snapshot_json(game.snapshot_json())
    after = bubble(step(restored), "zhou_niangzi")
    pointing_to = phrases.named(
        voices.phrase("zhou_niangzi", "point_hub", me(game)["talk"]["until"]),
        lore().names["cha_laoban"],
    )  # she knows nothing of it, and sends the manager to the teahouse
    assert after == before == pointing_to
