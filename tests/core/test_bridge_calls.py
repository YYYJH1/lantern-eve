"""The names a person uses for others: what they say, what a model is asked, and what is checked.

A person of the cast may have a table of names of their own (``call`` in ``content/lines``). Where
the core says a name inside what a person says, it says the name that person uses: the table's for
someone it lists, the cast's for anyone else. What is not a person speaking keeps the cast's names.
A person who speaks of themself says "I", as before. The prompt for a model's reply carries the
table, and the checker of the reply takes the names in it for the people they stand for, for that
speaker and no one else.

The real tables are written by the content and are not read here: the tests give the voices tables
of their own (``call_helpers``).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from typing import Any

import bridge_driver
import persuade_driver
import pytest
from bridge_helpers import bridge, run_to, state_of, world_of
from call_helpers import BROTHER, GRANNY, MAKER, SHOPKEEPER, TABLES, Calls
from dealings_helpers import believe, talking
from player_helpers import acks, act, beside, silence
from speech_helpers import belief, errors, hold, new_game, reply, say, unnamed
from voice_helpers import bubble

from lantern_core.cognition.beliefs import Belief
from lantern_core.cognition.lexicon import NAME, normalise, scan
from lantern_core.world.bridge import converse, prompts, social, speech, telling, voices
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.prompt_data import PROMPTS

LO = lore()
SCRIPT = speech.script()
AT_BRIDGE = "pr_liner_at_bridge"  # Li Er was at the bridge last night
LOOKING = "pr_liner_looking"  # Li Er was looking for his lantern at the bridge: a plain act
ROUND = "pr_gengfu_round"  # the watchman went his round over the bridge: a plain act
BOAT, LI_ER = "pr_boat_damaged", "pr_liner_damaged"
MARKER = re.compile(r"〔[a-z_]+>[a-z_]+〕|<[a-z_]+>[a-z_]+")
WATER = [unnamed("pr_flooded"), unnamed("pr_rail_broken")]


@pytest.fixture
def calls():
    table = Calls()
    yield table
    table.restore()


def has(text: str, name: str) -> bool:
    """Whether ``text`` holds ``name``, in any case (a sentence starts in capitals)."""
    return name.lower() in text.lower()


def named_in(text: dict[str, str], person: str) -> bool:
    """Whether the words hold the cast's name for ``person`` in either language."""
    cast = LO.names[person]
    return cast["zh"] in text["zh"] or has(text["en"], cast["en"].removeprefix("the "))


def told(speaker, prop_id=AT_BRIDGE, source="zhou_zhanggui", modality="assert", pick=0, tick=70):
    return voices.claim_words(LO.book.props[prop_id], modality, source, speaker, pick, tick)


def every_way(speaker, prop_id=AT_BRIDGE, source="zhou_zhanggui"):
    """What ``speaker`` says in the variants of their frame, over enough ticks to use them all."""
    return [told(speaker, prop_id, source, tick=tick) for tick in range(24)]


# ------------------------------------------------------------------------------ what is told


def test_a_person_names_the_people_in_what_they_tell_as_their_table_does(calls):
    calls.tables()
    ways = every_way(GRANNY)
    assert len({w["zh"] for w in ways}) >= 2  # both ways of her frame were used
    for said in ways:
        assert "周家那个掌柜" in said["zh"] and "老二" in said["zh"]
        assert not named_in(said, "zhou_zhanggui") and not named_in(said, "li_er")
        assert has(said["en"], "that Zhou shopkeeper") and re.search(r"\bEr\b", said["en"])


def test_a_person_the_table_does_not_list_goes_by_the_name_of_the_cast(calls):
    calls.tables()
    for said in every_way(GRANNY, "pr_dalang_at_bridge", "cha_laoban"):
        assert named_in(said, "zhou_dalang") and named_in(said, "cha_laoban")


def test_a_table_is_its_owners_alone(calls):
    calls.only({})
    plain = every_way("gengfu")
    calls.tables()
    assert every_way("gengfu") == plain  # the watchman has no table, and the others' are not his
    assert every_way(GRANNY) != plain
    for said in plain:
        assert named_in(said, "zhou_zhanggui") and named_in(said, "li_er")


def test_the_same_person_is_a_different_name_in_each_mouth(calls):
    calls.tables()
    mother = every_way(GRANNY, LOOKING, "self_seen")
    brother = every_way(BROTHER, LOOKING, "self_seen")
    assert all("老二" in w["zh"] and "李家老二" not in w["zh"] for w in mother)  # her second son
    assert all("李家老二" in w["zh"] for w in brother)  # to the Zhou house he is the Li boy
    assert not any(named_in(w, "li_er") for w in mother + brother)


def test_a_person_who_speaks_of_themself_says_i_whatever_the_table_says(calls):
    calls.install("li_er", {"li_er": {"zh": "老二", "en": "Er"}})  # the checker refuses this table
    said = told("li_er", AT_BRIDGE, "self_seen")
    assert "我" in said["zh"] and "老二" not in said["zh"]
    assert re.search(r"\bI\b", said["en"]) and not re.search(r"\bEr\b", said["en"])


def test_the_account_somebody_else_told_is_named_as_the_speaker_names_them(calls):
    calls.tables()
    prop = LO.book.props[LI_ER]
    for tick in range(24):
        said = voices.rival_words(prop, "zhou_zhanggui", GRANNY, tick)
        assert "周家那个掌柜" in said["zh"] and "老二" in said["zh"]
        assert not named_in(said, "zhou_zhanggui") and not named_in(said, "li_er")
        assert has(said["en"], "that Zhou shopkeeper") and re.search(r"\bEr\b", said["en"])


def test_a_person_with_no_voice_and_the_names_of_the_town_are_left_alone(calls):
    calls.only({})
    assert voices.calls("stranger") == {} and voices.names_for("stranger") is LO.names
    assert voices.called("stranger", "li_er") == LO.names["li_er"]
    before = json.dumps(LO.names, sort_keys=True, ensure_ascii=False)
    calls.tables()
    assert voices.names_for(GRANNY)["li_er"] == TABLES[GRANNY]["li_er"]
    assert voices.names_for(GRANNY)["gengfu"] == LO.names["gengfu"]  # no entry: the cast's own
    assert json.dumps(LO.names, sort_keys=True, ensure_ascii=False) == before  # laid over, not in


def test_the_cache_of_the_words_does_not_outlive_the_table(calls):
    as_it_was = told(GRANNY)  # with whatever the content gives her
    calls.only({})
    plain = told(GRANNY)
    calls.tables()
    assert told(GRANNY) != plain
    calls.restore()
    assert told(GRANNY) == as_it_was


# ------------------------------------------------------------------------------ in a game


class Recorder:
    """Stands for the sim where only ``emit`` is wanted."""

    def __init__(self):
        self.events = []

    def emit(self, kind, **fields):
        self.events.append({"kind": kind, **fields})


def hear(game, who, prop_id, confidence, teller):
    """``who`` is told ``prop_id`` by ``teller``, and holds on to what they believe already."""
    section = state_of(game)["social"]
    heard = Belief(who, prop_id, "assert", confidence, "heard", teller, teller, 1, 9, "c1")
    return telling._hold(
        Recorder(), section, LO, social.book(section), LO.book.props[prop_id], heard, "c1"
    )


def torn(who=GRANNY):
    """A conversation with a person who holds the boat account (told by the watchman) and has been
    told the account of Li Er by the head of the Zhou house, which they did not take in."""
    game = talking(who)
    believe(game, who, BOAT, 70, source="heard", teller="gengfu")
    assert not hear(game, who, LI_ER, 50, "zhou_zhanggui")
    return game


def test_an_answer_names_the_people_in_it_as_the_one_who_answers_does_and_the_prompt_does_not(
    calls,
):
    calls.tables()
    game = torn()
    out = act(game, "ask", topic=BOAT)
    said = bubble(out, GRANNY)
    assert named_in(said, "old_he") and named_in(said, "gengfu")  # not in her table
    assert "周家那个掌柜" in said["zh"] and "老二" in said["zh"]  # the account she set aside
    assert not named_in(said, "zhou_zhanggui") and not named_in(said, "li_er")
    world = state_of(game)
    plain = converse.words(world, world["player"]["line"], plain=True)
    assert named_in(plain, "zhou_zhanggui") and named_in(plain, "li_er")
    assert "周家那个掌柜" not in plain["zh"] and "老二" not in plain["zh"]
    assert converse.words(world, world["player"]["line"]) == said


def test_a_person_who_points_the_way_names_the_one_they_point_to_as_they_call_them(calls):
    calls.install(
        GRANNY, {"cha_laoban": {"zh": "茶馆里的老板娘", "en": "the madam at the teahouse"}}
    )
    game = talking(GRANNY)
    out = act(game, "ask", topic="t_honor_light")  # nobody holds anything about it
    said = bubble(out, GRANNY)
    assert "茶馆里的老板娘" in said["zh"] and "the madam at the teahouse" in said["en"]
    assert not named_in(said, "cha_laoban")
    world = state_of(game)
    line = world["player"]["line"]
    assert line[2] == "point" and line[4] == "cha_laoban"  # the state keeps who, never the name
    plain = converse.words(world, line, plain=True)
    assert named_in(plain, "cha_laoban") and "茶馆里的老板娘" not in plain["zh"]


def test_the_line_that_points_to_somebody_who_was_heard_names_them_the_same_way(calls):
    calls.tables()
    world = state_of(talking(GRANNY))
    line = [GRANNY, 100, "point", "point_heard", "zhou_zhanggui"]
    said = converse.words(world, line)
    assert "周家那个掌柜" in said["zh"] and has(said["en"], "that Zhou shopkeeper")
    assert not named_in(said, "zhou_zhanggui")
    plain = converse.words(world, line, plain=True)
    assert named_in(plain, "zhou_zhanggui")


def meet(game, who):
    if state_of(game)["player"]["talk"]:
        act(game, "leave")
    for _ in range(80):
        beside(game, who)
        silence(game)
        out = act(game, "talk", npc=who)
        if acks(out) != [("rejected", "busy")]:
            break
    assert acks(out) == [("applied", None)], (who, acks(out))


def test_a_person_asked_what_another_likes_names_them_as_they_call_them(calls):
    calls.install("cha_laoban", {"li_laotai": {"zh": "李家老太太", "en": "old Madam Li"}})
    game = talking(GRANNY)
    act(game, "leave")
    meet(game, "cha_laoban")
    said = bubble(act(game, "ask", topic="likes:li_laotai"), "cha_laoban")
    assert said["zh"].startswith("李家老太太") and "李老太" not in said["zh"]
    assert said["en"].startswith("Old Madam Li ")  # a sentence starts in a capital, as a name does
    assert "Granny Li" not in said["en"]


def test_a_person_with_no_name_for_the_one_asked_after_says_the_name_of_the_cast(calls):
    calls.install("cha_laoban", {"li_da": {"zh": "老大", "en": "Da"}})
    game = talking(GRANNY)
    act(game, "leave")
    meet(game, "cha_laoban")
    said = bubble(act(game, "ask", topic="likes:li_laotai"), "cha_laoban")
    assert said["zh"].startswith(LO.names["li_laotai"]["zh"])
    assert said["en"].startswith(LO.names["li_laotai"]["en"])


def test_the_talk_between_neighbours_over_their_heads_is_in_the_speakers_names(calls, monkeypatch):
    monkeypatch.setattr(social, "near", lambda state, who: True)  # the manager hears them all
    calls.everyone()
    heard: list[dict[str, Any]] = []
    run_to(
        bridge(1),
        1500,
        lambda out: heard.extend(b for b in out["frame"]["bubbles"] if b.get("text")),
    )
    assert len(heard) > 20
    assert sum(bool(MARKER.search(b["text"]["zh"])) for b in heard) > 10
    assert sum(bool(MARKER.search(b["text"]["en"])) for b in heard) > 10
    for b in heard:  # no one is named by the cast but the manager and the person themself
        others = [p for p in LO.people if p != b["npc"] and named_in(b["text"], p)]
        assert others == [], (b["npc"], b["text"])


def test_the_state_of_the_world_does_not_know_there_are_tables(calls):
    def snapshot(ticks):
        driver = bridge_driver.Driver(restores=False)
        driver.run_to(ticks)
        return json.loads(driver.game.snapshot_json())

    plain = snapshot(1500)
    calls.everyone()
    called = snapshot(1500)
    assert called["world"] == plain["world"]  # nothing of the world: words are made in the frame
    rest = ("world", "requests")
    assert {k: v for k, v in called.items() if k not in rest} == {
        k: v for k, v in plain.items() if k not in rest
    }
    assert len(called["requests"]) == len(plain["requests"]) > 0
    assert called["requests"] != plain["requests"]  # the prompts carry the tables
    for now, then in zip(called["requests"], plain["requests"], strict=True):
        words = ("messages", "reserve", "hold")  # what a request says, and what its words cost
        assert {k: v for k, v in now.items() if k not in words} == {
            k: v for k, v in then.items() if k not in words
        }


def test_the_tables_are_no_part_of_the_content_the_hashes_are_made_from(calls):
    world = world_of(talking(GRANNY))
    before = world.content_hash()
    world._content_hash = None  # made again from the content as it stands
    calls.everyone()
    assert world.content_hash() == before


# ------------------------------------------------------------------------------ not a person


def walk(value: Any, path: tuple = ()) -> Iterator[tuple[str, str]]:
    """Every text in ``value`` with the shape of the path to it (list places are ``*``)."""
    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk(item, (*path, key))
    elif isinstance(value, list):
        for item in value:
            yield from walk(item, (*path, "*"))
    elif isinstance(value, str):
        yield ".".join(path), value


# the places where a name may be a person's own: the words over a head, and what a model is asked
SPOKEN = ("frame.bubbles.*.text.zh", "frame.bubbles.*.text.en", "requests.*.messages.*.content")


def test_a_name_of_a_table_is_only_ever_in_the_words_of_a_person_and_in_the_prompt(calls):
    """Everyone has a table of marked names, and the first two days of the persuasion game are
    played, with talks, questions, promises, the clarification and the evening at the teahouse.
    The notebook, the cards, the tasks, the paper and the recaps name people as the cast does."""
    calls.everyone()
    driver = persuade_driver.Driver(restores=False)
    found: dict[str, int] = {}
    spoken = 0
    while driver.game.tick < 2 * persuade_driver.DAY:
        _, out = driver.call()
        for shape, text in walk(out):
            if MARKER.search(text):
                found[shape] = found.get(shape, 0) + 1
        world = state_of(driver.game)
        line = world["player"]["line"]
        if line and line[2] in ("claim", "point") and line[1] > driver.game.tick:
            here = [b["text"] for b in out["frame"]["bubbles"] if b["npc"] == line[0]]
            spoken += bool(here)
            for text in here:
                others = [p for p in LO.people if p != line[0] and named_in(text, p)]
                assert others == [], (line, text)
    assert set(found) <= set(SPOKEN), found
    assert "frame.bubbles.*.text.zh" in found and "frame.bubbles.*.text.en" in found
    assert spoken > 3


# ------------------------------------------------------------------------------ the prompt


def turn():
    return prompts.Turn(
        verb="ask",
        outcome="claim",
        topic={"zh": "栏杆", "en": "the rail"},
        topic_props=("pr_rail_broken",),
        act={"path": "belief", "prop": "pr_rail_broken", "modality": "assert", "source": "unknown"},
        line={"zh": "栏杆坏了。", "en": "The rail is broken."},
    )


def ask_for(game, who):
    return prompts.reply_messages(world_of(game), state_of(game), game.tick, who, turn())


def test_the_prompt_carries_the_table_of_the_speaker_after_how_they_speak(calls):
    game = talking(GRANNY)
    calls.only({})
    plain = ask_for(game, GRANNY)
    calls.tables()
    system, user = (m["content"] for m in ask_for(game, GRANNY))
    note = prompts.calls_note(GRANNY)
    assert note and system.replace(note, "") == plain[0]["content"]  # nothing else moved
    assert user == plain[1]["content"]
    assert system.index(PROMPTS["voices"][GRANNY]["zh"] + note) < system.index("What the town says")
    assert prompts.CALLS_NOTE in system
    cast = [person for person in LO.people if person in TABLES[GRANNY]]
    rows = [line for line in system.splitlines() if line.startswith("- ")]
    assert len(rows) == len(TABLES[GRANNY])
    for row, other in zip(rows, cast, strict=True):  # in the order of the cast
        pair = TABLES[GRANNY][other]
        names = LO.names[other]
        assert row == (
            f'- {names["en"]} ({names["zh"]}): "{pair["en"]}" in English, "{pair["zh"]}" in Chinese'
        )


def test_a_person_with_no_table_is_asked_in_the_words_they_always_were(calls):
    game = talking("gengfu", hour=16)
    calls.only({})
    plain = ask_for(game, "gengfu")
    calls.tables()
    assert ask_for(game, "gengfu") == plain
    assert prompts.calls_note("gengfu") == "" and prompts.CALLS_NOTE not in plain[0]["content"]


def test_only_the_reply_prompt_carries_the_table(calls):
    game = talking(GRANNY)
    calls.tables()
    judge = prompts.judge_messages(world_of(game), GRANNY, {"zh": "借竹子", "en": "lend"}, "hi")
    assert prompts.CALLS_NOTE not in judge[0]["content"]


# ------------------------------------------------------------------------------ what is checked


def free(game, who, zh, en, acts):
    return say(game, who, reply(acts, zh=zh, en=en))


@pytest.fixture
def game():
    return new_game(1)


def looking_for(game, who):
    hold(game, who, LOOKING)
    return [unnamed(LOOKING)]


def test_a_name_of_the_table_is_the_name_of_the_person_it_stands_for(game, calls):
    calls.tables()
    acts = looking_for(game, GRANNY)
    got = free(
        game, GRANNY, "老二在石桥找灯笼。", "Er was looking for the lantern at the bridge.", acts
    )
    assert got.ok, got.errors


def test_a_name_of_the_table_that_no_act_covers_is_refused_like_the_cast_name(game, calls):
    calls.tables()
    hold(game, GRANNY, ROUND)
    acts = [unnamed(ROUND)]
    got = free(game, GRANNY, "老二在石桥。", "Er was at the bridge.", acts)
    assert errors(got) == [("entity", "line.en", "name"), ("entity", "line.zh", "name")]
    assert "li_er" in got.errors[0].detail and "li_er" in got.errors[1].detail
    cast = free(game, GRANNY, "李二在石桥。", "Li Er was at the bridge.", acts)
    assert errors(cast) == errors(got)  # the cast's name is refused in the same way


def test_a_word_that_names_no_one_for_a_person_without_it_in_their_table_is_not_checked(
    game, calls
):
    calls.tables()
    hold(game, "gengfu", ROUND)
    got = free(game, "gengfu", "老二在石桥。", "Er was at the bridge.", [unnamed(ROUND)])
    assert got.ok, got.errors  # the watchman has no 老二 to name anyone by


def test_a_word_is_the_person_each_speaker_says_it_for_and_a_wrong_person_is_refused(game, calls):
    calls.tables()
    zh, en = "老二在石桥找灯笼。", "My brother was looking for the lantern at the bridge."
    hold(game, BROTHER, LOOKING)
    got = free(game, BROTHER, zh, en, [unnamed(LOOKING)])
    assert errors(got) == [("entity", "line.en", "name"), ("entity", "line.zh", "name")]
    assert "zhou_erlang" in got.errors[0].detail  # in the Zhou house 老二 is the second Zhou son
    mother = free(
        game, GRANNY, zh, "Er was looking for the lantern at the bridge.", looking_for(game, GRANNY)
    )
    assert mother.ok, mother.errors  # and in Granny's mouth the second Li son


def test_a_name_of_the_table_wins_over_the_one_the_town_gives_the_same_word(game, calls):
    """The lantern maker calls the second Li son 二郎, which is the town's word for the second
    Zhou son. For her it is the Li son, and for the watchman it is still the Zhou son."""
    calls.tables()
    zh, en = "二郎在石桥找灯笼。", "Erlang was looking for the lantern at the bridge."
    hold(game, MAKER, LOOKING)
    assert free(game, MAKER, zh, en, [unnamed(LOOKING)]).ok
    hold(game, "gengfu", LOOKING)
    other = free(game, "gengfu", zh, en, [unnamed(LOOKING)])
    assert errors(other) == [("entity", "line.en", "name"), ("entity", "line.zh", "name")]
    assert "zhou_erlang" in other.errors[0].detail


def test_the_words_of_a_table_are_kept_back_with_the_names_of_what_the_speaker_guards(game, calls):
    zh, en = "我家那孩子在桥下。", "My boy is under the bridge."
    calls.install(SHOPKEEPER, {"zhou_dalang": {"zh": "我家那孩子", "en": "my boy"}})
    got = free(game, SHOPKEEPER, zh, en, WATER)
    # the head of the Zhou house keeps back what blames his son: the name is no way round it
    assert errors(got) == [("private", "line.en", "guarded"), ("private", "line.zh", "guarded")]
    calls.only({})
    cast = free(game, SHOPKEEPER, "周家大郎在桥下。", "Zhou Dalang is under the bridge.", WATER)
    assert errors(cast) == errors(got)
    # and without the table, the same words name no one and pass
    assert free(game, SHOPKEEPER, zh, en, WATER).ok


def test_the_sentence_the_core_writes_for_a_reply_is_in_the_speakers_names(game, calls):
    calls.tables()
    hold(game, GRANNY, AT_BRIDGE, "heard", teller="zhou_zhanggui", claimed="zhou_zhanggui", hop=1)
    got = say(game, GRANNY, reply([belief(AT_BRIDGE, "zhou_zhanggui")]))
    assert got.ok and got.by == "core"
    assert "老二" in got.line["zh"] and "周家那个掌柜" in got.line["zh"]
    assert not named_in(got.line, "li_er") and not named_in(got.line, "zhou_zhanggui")
    assert not MARKER.search(json.dumps(got.line, ensure_ascii=False))


def test_every_sentence_the_core_says_for_a_speaker_names_only_what_the_prop_is_about(calls):
    """The names of a table are read by the checker as the sentences are written: a sentence that
    the town's lines make for a speaker, for each prop of the script, holds the names of the people
    in the prop and of no one else."""
    calls.tables()
    for speaker in TABLES:
        vocab = SCRIPT.vocabulary.calling(voices.calls(speaker))
        for pid, prop in LO.book.props.items():
            said = LO.lines.statement(prop, voices.names_for(speaker), speaker)
            entities = {entity for _, entity in prop.args}
            for lang, text in said.items():
                found = {
                    ident
                    for _, _, (kind, ident) in scan(normalise(text), vocab.terms)
                    if kind == NAME
                }
                assert found <= entities, (speaker, pid, lang, text, found - entities)


# ------------------------------------------------------------------------------ the vocabulary


def test_the_vocabulary_of_a_speaker_has_their_names_and_the_words_they_take_from_others():
    vocab = SCRIPT.vocabulary

    def names(v, text):
        return [ident for _, _, (kind, ident) in scan(normalise(text), v.terms) if kind == NAME]

    assert vocab.calling({}) is vocab  # a speaker with no names has the vocabulary itself
    mine = vocab.calling(TABLES[MAKER])
    assert mine is vocab.calling(dict(TABLES[MAKER]))  # made once for a table, and kept
    assert names(vocab, "二郎在这儿") == ["zhou_erlang"]
    assert names(mine, "二郎在这儿") == ["li_er"]
    assert ("二郎", False) in mine.words_of(NAME, "li_er")
    assert ("二郎", False) not in mine.words_of(NAME, "zhou_erlang")
    assert ("周二郎", False) in mine.words_of(NAME, "zhou_erlang")  # and their other names stay
    assert ("二郎", False) in vocab.words_of(NAME, "zhou_erlang")  # the town's is as it was
    assert names(mine, "Erlang is here") == ["li_er"]
    assert names(vocab, "Erlang is here") == ["zhou_erlang"]


def test_an_english_name_with_an_article_is_known_without_it():
    mine = SCRIPT.vocabulary.calling({"li_er": {"zh": "李家老二", "en": "the Li boy"}})
    found = [ident for _, _, (kind, ident) in scan(normalise("Where is the Li boy?"), mine.terms)]
    assert found == ["li_er"]


def test_a_speaker_with_a_table_checks_the_words_of_a_reply_as_one_without_does_otherwise(
    game, calls
):
    calls.only({})
    hold(game, GRANNY, ROUND)
    acts = [unnamed(ROUND)]
    before = free(game, GRANNY, "老二在石桥。", "Er was at the bridge.", acts)
    assert before.ok  # nothing names anyone yet
    calls.tables()
    after = free(game, GRANNY, "老二在石桥。", "Er was at the bridge.", acts)
    assert not after.ok and {e.type for e in after.errors} == {"entity"}
    calls.only({})
    assert free(game, GRANNY, "老二在石桥。", "Er was at the bridge.", acts).ok
