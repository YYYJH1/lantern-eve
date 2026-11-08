"""The voices of the townsfolk: their content, their compiled form, and what the checker refuses."""

from __future__ import annotations

import copy
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

import check_content as cc
import sentence_content as sc
import voice_content as vc
from lantern_core import canon
from lantern_core.world.bridge import phrases, voice_data

ROOT = Path(__file__).resolve().parents[2]
COMPILED = ROOT / "content" / "compiled"
BASE = cc.load_sources(ROOT)
DOC = canon.loads((COMPILED / "voices.json").read_bytes())
CAST = canon.loads((COMPILED / "cast_bridge_v0.json").read_bytes())
PEOPLE = [p["id"] for p in CAST["people"]]
CODES = sorted(phrases.PHRASES)
FRAMES = sorted(sc.FRAME_SLOTS)
CJK = re.compile(r"[㐀-鿿]")
SLOT = re.compile(r"\{(\w+)\}")
WORDS = re.compile(r"[\W_]+")
BANNED = ("；", ";", "—", "–", "―", "--", " - ")  # no semicolon, and no dash of any width


def check(mutate: Callable[[cc.Sources], None]) -> list[str]:
    """Apply ``mutate`` to a copy of the sources and return the errors of the checker."""
    src = copy.deepcopy(BASE)
    mutate(src)
    return cc.validate(src).errors


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


def lines_of(src: cc.Sources, person: str = "cha_laoban") -> dict[str, Any]:
    return src.voices[person]["lines"]


def frames_of(src: cc.Sources, person: str = "cha_laoban") -> dict[str, Any]:
    return src.voices[person]["frames"]


# ------------------------------------------------------------------------------ the content


def test_every_person_of_the_cast_has_a_voice_and_nobody_else():
    assert len(PEOPLE) == 20
    assert sorted(DOC) == sorted(PEOPLE) == sorted(BASE.voices)


@pytest.mark.parametrize("person", PEOPLE)
def test_a_person_has_at_least_two_variants_of_every_line_and_frame_in_both_languages(person):
    voice = DOC[person]
    own = ["chat", "epilogue", "frames", "greet", "hedges", "lines"]  # the ten who carry the days
    assert sorted(voice) in (["frames", "hedges", "lines"], own)
    assert sorted(voice["lines"]) == CODES and sorted(voice["frames"]) == FRAMES
    for table in ("lines", "frames"):
        for kind, variants in voice[table].items():
            assert len(variants) >= 2, (person, kind)
            for pair in variants:
                assert sorted(pair) == ["en", "zh"], (person, kind)
                assert pair["zh"].strip() and pair["en"].strip(), (person, kind)
    assert len(voice["hedges"]["zh"]) == len(voice["hedges"]["en"]) >= 2


@pytest.mark.parametrize("person", PEOPLE)
def test_the_chinese_is_chinese_and_the_english_is_not(person):
    for table in ("lines", "frames"):
        for kind, variants in DOC[person][table].items():
            for pair in variants:
                assert CJK.search(SLOT.sub("", pair["zh"])), (person, kind, pair)
                assert not CJK.search(pair["en"]), (person, kind, pair)
                assert pair["en"].isascii() or "’" not in pair["en"], (person, kind, pair)
    for word in DOC[person]["hedges"]["zh"]:
        assert CJK.search(word)
    for word in DOC[person]["hedges"]["en"]:
        assert not CJK.search(word) and word.startswith("I")


@pytest.mark.parametrize("person", PEOPLE)
def test_no_semicolon_no_dash_and_no_chain_of_comma_clauses(person):
    for table in ("lines", "frames"):
        for kind, variants in DOC[person][table].items():
            for pair in variants:
                for lang, text in pair.items():
                    assert not any(mark in text for mark in BANNED), (person, kind, text)
                    sentences = re.split(r"[。！？]" if lang == "zh" else r"[.!?]", text)
                    limit = 1 if lang == "zh" else 2
                    commas = "，" if lang == "zh" else ","
                    assert max(s.count(commas) for s in sentences) <= limit, (person, kind, text)


@pytest.mark.parametrize("person", PEOPLE)
def test_every_variant_ends_a_sentence_and_means_the_same_mood_in_both_languages(person):
    for table in ("lines", "frames"):
        for kind, variants in DOC[person][table].items():
            for pair in variants:
                assert pair["zh"][-1] in "。！？…）" and pair["en"][-1] in ".!?)", (person, pair)
                assert ("？" in pair["zh"]) == ("?" in pair["en"]), (person, kind, pair)
                assert ("！" in pair["zh"]) == ("!" in pair["en"]), (person, kind, pair)


@pytest.mark.parametrize("person", PEOPLE)
def test_a_fixed_line_has_no_slot_and_a_frame_has_the_slots_it_needs_once_in_each_language(person):
    for kind, variants in DOC[person]["lines"].items():
        named = sorted(vc.LINE_SLOTS.get(kind, ()))  # only a line that points names anyone
        for pair in variants:
            for lang in ("zh", "en"):
                assert sorted(SLOT.findall(pair[lang])) == named, (person, kind, pair)
            assert not re.search(r"[{}\[\]]", SLOT.sub("", pair["zh"] + pair["en"]))
            for match in SLOT.finditer(pair["en"]):  # and a name may start with "the"
                before = pair["en"][: match.start()].rstrip()
                assert before and not before.endswith((".", "!", "?")), (person, kind, pair)
    for key, variants in DOC[person]["frames"].items():
        needs = vc.FRAME_NEEDS[key]
        for pair in variants:
            for lang in ("zh", "en"):
                slots = SLOT.findall(pair[lang])
                assert sorted(slots) == sorted(needs), (person, key, pair)
            for match in SLOT.finditer(pair["en"]):
                before = pair["en"][: match.start()].rstrip()
                if match.group(1) != "hedge":
                    # the core capitalises the first letter only, and a name may start with "the"
                    assert not before.endswith((".", "!", "?")), (person, key, pair)


def test_no_two_people_say_a_fixed_line_or_a_frame_in_the_same_words():
    for table in ("lines", "frames"):
        for kind in CODES if table == "lines" else FRAMES:
            for lang in ("zh", "en"):
                said: dict[str, str] = {}
                for person in PEOPLE:
                    for pair in DOC[person][table][kind]:
                        key = WORDS.sub("", pair[lang]).lower()
                        assert said.setdefault(key, person) == person, (kind, lang, pair)


def test_no_voice_repeats_the_plain_words_of_the_core():
    for person in PEOPLE:
        for code, variants in DOC[person]["lines"].items():
            for pair in variants:
                for lang in ("zh", "en"):
                    plain = WORDS.sub("", phrases.PHRASES[code][lang]).lower()
                    assert WORDS.sub("", pair[lang]).lower() != plain, (person, code, lang)


def test_a_person_never_says_two_different_lines_in_the_same_words():
    for person in PEOPLE:
        for lang in ("zh", "en"):
            said: dict[str, str] = {}
            for code, variants in DOC[person]["lines"].items():
                for pair in variants:
                    key = WORDS.sub("", pair[lang]).lower()
                    assert said.setdefault(key, code) == code, (person, lang, code, pair)


def test_the_voices_keep_the_characters_they_were_written_for():
    def length(person: str) -> float:
        texts = [p["zh"] for v in DOC[person]["lines"].values() for p in v]
        return sum(len(t) for t in texts) / len(texts)

    def share(person: str, mark: str) -> float:
        texts = [p["zh"] for v in DOC[person]["lines"].values() for p in v]
        return sum(mark in t for t in texts) / len(texts)

    others = sorted(length(p) for p in PEOPLE if p != "old_he")
    assert length("old_he") < others[len(others) // 2] / 2  # the boatman spends words like coins
    assert share("cha_laoban", "！") > 0.8  # the teahouse keeper makes everything an event
    assert share("zuzhang", "！") < 0.1 and share("zuzhang", "老夫") > 0.4  # the elder does not
    assert share("zhangfang", "！") < 0.1 and share("zhangfang", "账") > 0.1
    assert share("zhou_huoji", "小的") > 0.5  # the clerk's humility
    assert share("sishu_xiansheng", "在下") > 0.5  # the schoolmaster's
    for child in ("shitou", "xiao_man"):
        assert length(child) < sorted(others)[len(others) // 3]  # the children use short words


def test_nobody_says_他_or_她_of_a_person_in_general_in_the_lines_of_the_townsfolk():
    """A line that is the same whoever it is about, such as the answer of someone who will go and
    speak to a third person, leaves the person out or says 对方 or 这个人: the cast has fixed
    sexes, so 他 would be wrong for half of the town. The one line that remains says what the
    clerk saw of Li Er."""
    plain = re.compile(r"其他|他人|他们")
    found = {
        (person, code)
        for person in PEOPLE
        for code, variants in DOC[person]["lines"].items()
        if any(re.search(r"[他她]", plain.sub("", pair["zh"])) for pair in variants)
    }
    assert found == {("zhou_huoji", "witness_in_public")}
    assert not re.search(r"[他她]", phrases.PHRASES["will_ask"]["zh"])


def test_the_lantern_maker_and_the_temple_keeper_are_women_and_li_das_children_call_li_er_uncle():
    notes = {person: BASE.voices[person]["voice"] for person in PEOPLE}
    assert "女师傅" in notes["zhadeng_shifu"]["zh"] and "woman" in notes["zhadeng_shifu"]["en"]
    assert "妇人" in notes["miaozhu"]["zh"] and "woman" in notes["miaozhu"]["en"]
    for person in ("zhadeng_shifu", "miaozhu"):  # and the note does not call either of them he
        for lang in ("zh", "en"):
            assert not re.search(r"\b(he|his|him|himself)\b|他", notes[person][lang], re.I)
        text = (ROOT / "content" / "lines" / f"{person}.yaml").read_text(encoding="utf-8")
        comment = "".join(line for line in text.splitlines(keepends=True) if line.startswith("#"))
        assert "woman" in comment and not re.search(r"\b(he|his|him|himself)\b", comment, re.I)
    for child in ("li_xiaomei", "shitou"):
        lines = [pair for variants in DOC[child]["lines"].values() for pair in variants]
        assert not any("二哥" in pair["zh"] or "my brother" in pair["en"] for pair in lines), child
        rumour = DOC[child]["lines"]["hard_hc_li_bamboo_rumour"]
        assert any("我二叔" in v["zh"] and "my uncle" in v["en"] for v in rumour), child


# ------------------------------------------------------------------------------ compiled


def test_the_compiled_file_the_module_and_the_tool_agree():
    report = cc.validate(copy.deepcopy(BASE))
    assert report.errors == []
    assert report.outputs["voices.json"] == (COMPILED / "voices.json").read_bytes()
    assert voice_data.VOICES == DOC
    module = (ROOT / vc.MODULE).read_bytes()
    assert report.generated[vc.MODULE] == module
    assert module.decode("utf-8").count('"""') == 4  # the docstring, and the raw string
    assert any(
        line.startswith("voices: 20 people, 39 fixed lines and 8 frames")
        for line in report.coverage
    )


def test_the_note_on_how_a_person_talks_stays_out_of_the_compiled_document():
    assert all(
        set(v)
        in (
            {"frames", "hedges", "lines"},
            {"frames", "hedges", "lines", "greet", "chat", "epilogue"},
        )
        for v in DOC.values()
    )
    assert all(BASE.voices[p]["voice"]["zh"] and BASE.voices[p]["voice"]["en"] for p in PEOPLE)


def test_the_tool_reads_the_fixed_lines_of_the_core_from_their_file():
    assert vc.load_phrases(ROOT) == phrases.PHRASES == BASE.phrases
    assert vc.load_phrases(ROOT / "content") == {}  # no such file: nothing, and the checker says so


def test_the_checker_passes_the_voices():
    assert check(lambda s: None) == []


# ------------------------------------------------------------------------------ the checker


def test_a_person_without_a_file_or_a_file_without_a_person_is_refused():
    assert has(check(lambda s: s.voices.pop("old_he")), "old_he of the cast has no file")

    def stranger(s: cc.Sources) -> None:
        s.voices["nobody"] = dict(copy.deepcopy(s.voices["old_he"]), person="nobody")

    def renamed(s: cc.Sources) -> None:
        s.voices["old_he"]["person"] = "li_er"

    assert has(check(stranger), "lines/nobody.yaml: nobody is not a person of the cast")
    assert has(check(renamed), "the person 'li_er' must match the file name")
    assert has(check(lambda s: s.voices.clear()), "no file in content/lines")


def test_a_missing_or_stray_line_or_frame_is_refused():
    assert has(check(lambda s: lines_of(s).pop("busy")), "no lines for 'busy'")
    assert has(
        check(lambda s: lines_of(s).update(shout=lines_of(s)["busy"])),
        "'shout' is not a phrase of the core",
    )
    assert has(check(lambda s: frames_of(s).pop("seen")), "no frame 'seen'")
    assert has(
        check(lambda s: frames_of(s).update(dreamt=frames_of(s)["seen"])),
        "'dreamt' is not a frame of the town",
    )


def test_a_line_or_a_frame_with_fewer_than_two_variants_is_refused():
    assert has(
        check(lambda s: lines_of(s).update(busy=lines_of(s)["busy"][:1])),
        "busy",
        "needs at least 2 variants",
    )
    assert has(
        check(lambda s: frames_of(s).update(seen=frames_of(s)["seen"][:1])),
        "frame seen",
        "needs at least 2 variants",
    )


def test_two_variants_of_a_person_that_are_the_same_words_are_refused():
    def same(s: cc.Sources) -> None:
        both = lines_of(s)["busy"]
        both[1]["en"] = both[0]["en"].upper()

    def spaced(s: cc.Sources) -> None:
        both = lines_of(s)["busy"]
        both[1] = dict(both[0], zh=both[0]["zh"] + " ")

    assert has(check(same), "lines/cha_laoban.yaml: busy (en): two variants are the same")
    errors = check(spaced)
    assert has(errors, "busy #2 (zh): stray spaces") and has(errors, "busy (zh): two variants")


@pytest.mark.parametrize(
    ("change", "needle"),
    [
        (lambda p: p.update(en=""), "the English must be English text"),
        (lambda p: p.update(zh=""), "the Chinese must be Chinese text"),
        (lambda p: p.update(en="哎哟，我正忙着。"), "the English must be English text"),
        (lambda p: p.update(zh="I am busy."), "the Chinese must be Chinese text"),
        (lambda p: p.update(zh="哎哟，我正忙着"), "must end a sentence"),
        (lambda p: p.update(en="Oh, I am busy"), "must end a sentence"),
        (lambda p: p.update(en="Oh; I am busy."), "';' is not allowed"),
        (lambda p: p.update(zh="哎哟；我正忙着。"), "'；' is not allowed"),
        (lambda p: p.update(en="Oh — I am busy."), "'—' is not allowed"),
        (lambda p: p.update(en="Oh -- I am busy."), "'--' is not allowed"),
        (lambda p: p.update(zh="哎哟，我忙着，你等着，回头聊。"), "a chain of comma clauses"),
        (lambda p: p.update(en="Oh, I, the keeper, being busy, cannot talk."), "a chain of comma"),
        (lambda p: p.update(zh="哎哟,我正忙着。"), "write Chinese punctuation"),
        (lambda p: p.update(zh="哎哟Zhou我正忙着。"), "no Latin letters"),
        (lambda p: p.update(en="Oh… I am busy."), "three full stops"),
        (lambda p: p.update(zh="我正忙着？", en="I am busy."), "a question in one language"),
        (lambda p: p.update(zh="我正忙着！", en="I am busy."), "an exclamation in one language"),
        (lambda p: p.update(en=" I am busy."), "stray spaces"),
        (lambda p: p.update(zh="我正忙着{line}。"), "a fixed line has no slots"),
        (lambda p: p.update(zh="我正忙着{name}。"), "a fixed line has no slots"),
        (lambda p: p.update(en="I am busy " + "so " * 60 + "busy."), "longer than"),
    ],
)
def test_a_fixed_line_that_breaks_the_rules_of_the_voices_is_refused(change, needle):
    def mutate(s: cc.Sources) -> None:
        change(lines_of(s)["busy"][0])

    assert has(check(mutate), "lines/cha_laoban.yaml", needle)


@pytest.mark.parametrize(
    "code", sorted(c for c, slots in vc.LINE_SLOTS.items() if slots == {"name"})
)
@pytest.mark.parametrize(
    ("change", "needle"),
    [
        (
            lambda p: p.update(zh="这事我不清楚。", en="I do not know."),
            "{name} must be written once",
        ),
        (
            lambda p: p.update(zh="我不清楚{name}{name}。", en="I do not know {name} {name}."),
            "{name} must be written once",
        ),
        (lambda p: p.update(en="I do not know. Ask someone."), "{name} must be written once"),
        (lambda p: p.update(zh="问问{who}。", en="Ask {who}."), "is not a slot here"),
        (lambda p: p.update(zh="我不清楚。{name}知道。", en="{name} knows."), "starts a sentence"),
        (
            lambda p: p.update(zh="我不清楚。问{name}。", en="I do not know. {name} is the one."),
            "starts a sentence",
        ),
    ],
)
def test_a_line_that_points_names_the_person_once_and_never_to_begin_a_sentence(
    code, change, needle
):
    def mutate(s: cc.Sources) -> None:
        change(lines_of(s)[code][0])

    errors = check(mutate)
    assert has(errors, f"lines/cha_laoban.yaml: {code}", needle), (needle, errors)


GOODS_LINES = {
    "promise_open": {"amount", "item", "when"},
    "goods_enough": {"item"},
}


def test_the_lines_of_the_goods_are_the_slots_of_the_core_and_of_the_checker():
    assert vc.LINE_SLOTS["promise_open"] == GOODS_LINES["promise_open"]
    assert vc.LINE_SLOTS["goods_enough"] == GOODS_LINES["goods_enough"]
    core = vc.load_phrases(ROOT)
    for code, slots in GOODS_LINES.items():
        for lang in ("zh", "en"):
            assert set(SLOT.findall(core[code][lang])) == slots, (code, lang)


@pytest.mark.parametrize("code", sorted(GOODS_LINES))
@pytest.mark.parametrize(
    ("change", "needle"),
    [
        (lambda p: p.update(zh="这事我记着。", en="I remember."), "must be written once"),
        (
            lambda p: p.update(
                zh="{item}{item}{amount}{when}。", en="{item} {item} {amount} {when}."
            ),
            "must be written once",
        ),
        (lambda p: p.update(zh="问问{who}{item}。", en="Ask {who} {item}."), "is not a slot here"),
        (
            lambda p: p.update(
                zh="我记着。{item}{amount}{when}。", en="I remember. {amount} {item} {when}."
            ),
            "starts a sentence",
        ),
    ],
)
def test_a_line_of_the_goods_writes_its_slots_once_and_never_to_begin_a_sentence(
    code, change, needle
):
    def mutate(s: cc.Sources) -> None:
        change(lines_of(s)[code][0])

    errors = check(mutate)
    assert has(errors, f"lines/cha_laoban.yaml: {code}", needle), (needle, errors)


@pytest.mark.parametrize(
    ("change", "needle"),
    [
        (
            lambda p: p.update(zh="老夫亲眼所见。", en="My own eyes bear witness."),
            "{line} must be written once",
        ),
        (lambda p: p.update(zh="亲眼{line}所见{line}。"), "{line} must be written once"),
        (lambda p: p.update(en="I saw {teller} say {line}."), "{teller} is not a slot here"),
        (lambda p: p.update(zh="老夫见{teller}：{line}。"), "{teller} is not a slot here"),
        (
            lambda p: p.update(en="My own eyes bear witness."),
            "the two languages write different slots",
        ),
        (lambda p: p.update(en="My eyes saw it. {line}."), "{line} starts a sentence"),
        (lambda p: p.update(en="My eyes saw [it]: {line}."), "a frame has no optional parts"),
        (lambda p: p.update(zh="老夫亲眼所见：{line}{"), "a stray brace"),
    ],
)
def test_a_frame_that_breaks_the_rules_of_the_slots_is_refused(change, needle):
    def mutate(s: cc.Sources) -> None:
        change(frames_of(s, "zuzhang")["seen"][0])

    errors = check(mutate)
    assert has(errors, "lines/zuzhang.yaml: frame seen #1", needle), (needle, errors)


def test_a_guess_that_does_not_use_its_hedge_is_refused():
    def no_hedge(s: cc.Sources) -> None:
        frames_of(s)["guess_own"][0].update(zh="我也不确定。{line}。", en="I am not sure. {line}.")

    def half(s: cc.Sources) -> None:
        frames_of(s)["guess_heard"][0].update(en="{teller} told me. {line}.")

    assert has(check(no_hedge), "frame guess_own", "{hedge} must be written once")
    assert has(check(half), "frame guess_heard", "the two languages write different slots")


def test_the_hedges_are_checked_as_words_that_start_a_clause_with_i():
    def one(s: cc.Sources) -> None:
        s.voices["cha_laoban"]["hedges"] = s.voices["cha_laoban"]["hedges"][:1]

    def lower(s: cc.Sources) -> None:
        s.voices["cha_laoban"]["hedges"][0]["en"] = "perhaps"

    def stop(s: cc.Sources) -> None:
        s.voices["cha_laoban"]["hedges"][0]["zh"] = "我猜。"

    def twin(s: cc.Sources) -> None:
        hedges = s.voices["cha_laoban"]["hedges"]
        hedges[1] = dict(hedges[0])

    assert has(check(one), "hedges", "needs at least 2 hedges")
    assert has(check(lower), "hedges #1 (en)", "starts with I")
    assert has(check(stop), "hedges #1 (zh)", "bare words")
    assert has(check(twin), "hedges", "two hedges are the same")


def test_two_people_who_say_the_same_thing_in_the_same_words_are_refused():
    def echo(s: cc.Sources) -> None:
        lines_of(s, "old_he")["busy"][0] = copy.deepcopy(lines_of(s, "cha_laoban")["busy"][0])

    def echo_frame(s: cc.Sources) -> None:
        frames_of(s, "old_he")["seen"][0] = copy.deepcopy(frames_of(s, "cha_laoban")["seen"][0])

    assert has(check(echo), "say busy the same way", "cha_laoban", "old_he")
    assert has(check(echo_frame), "say seen the same way")


def test_a_person_who_says_two_different_lines_in_the_same_words_is_refused():
    def mutate(s: cc.Sources) -> None:
        lines_of(s)["cannot"][0] = copy.deepcopy(lines_of(s)["busy"][0])

    assert has(check(mutate), "lines/cha_laoban.yaml", "'busy' and 'cannot' are the same words")


def test_a_voice_that_repeats_the_plain_words_of_the_core_is_refused():
    def mutate(s: cc.Sources) -> None:
        lines_of(s)["busy"][0] = dict(phrases.PHRASES["busy"])

    assert has(check(mutate), "lines/cha_laoban.yaml: busy", "the same words as the plain voice")


def test_a_new_fixed_line_in_the_core_needs_a_line_from_everyone():
    def mutate(s: cc.Sources) -> None:
        s.phrases["new_code"] = {"zh": "新的。", "en": "New."}

    errors = check(mutate)
    assert len([e for e in errors if "no lines for 'new_code'" in e]) == 20


def test_a_stray_key_or_a_missing_note_in_a_file_is_refused():
    assert has(check(lambda s: s.voices["old_he"].update(mood="grim")), "mood")
    assert has(check(lambda s: s.voices["old_he"].pop("voice")), "voice")
    assert has(check(lambda s: s.voices["old_he"].update(voice={"zh": "", "en": ""})), "voice")
