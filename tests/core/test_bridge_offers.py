"""What the frame puts forward for each verb that takes a choice, and the verbs of the manager."""

import json
import re
from pathlib import Path

import pytest
from bridge_helpers import CAST, CLEAR, bridge, state_of, step, world_of
from dealings_helpers import acks, act, know, talking, trust
from player_helpers import ack, plain

from lantern_core import canon
from lantern_core.world.bridge import bonds, notebook, offers, player
from lantern_core.world.bridge.lore import lore

I18N = Path(__file__).resolve().parents[2] / "web" / "src" / "i18n"
WEB_EN = (I18N / "en.ts").read_text(encoding="utf-8")
WEB_ZH = (I18N / "zh.ts").read_text(encoding="utf-8")

VERBS = ("tell", "entrust", "promise", "speak")


def offered(game, verb):
    return step(game)["frame"]["player"]["offers"][verb]


def ids(game, verb):
    return [o["id"] for o in offered(game, verb)]


def test_every_verb_has_a_list_of_offers_in_every_frame_and_the_lists_are_empty_away_from_a_talk():
    game = bridge(1, **CLEAR)
    frame = step(game)["frame"]
    assert frame["player"]["offers"] == {verb: [] for verb in VERBS}
    plain(frame)
    assert canon.dumps_str(frame) == canon.dumps_str(json.loads(canon.dumps_str(frame)))


def test_in_a_conversation_the_manager_is_offered_what_they_can_tell_ask_and_promise():
    game = talking("li_da")
    frame = step(game)["frame"]
    assert set(frame["player"]["offers"]) == set(VERBS)
    assert frame["player"]["offers"]["speak"] == []  # it is no place to speak in public
    assert frame["player"]["offers"]["promise"]
    assert frame["player"]["offers"]["tell"] == []  # nothing in the notebook to tell
    verbs = frame["hud"]["verbs"]
    assert [v for v in player.VERB_ORDER if v in verbs] == verbs  # in the order of the list
    assert {"tell", "entrust", "promise"} <= set(verbs) and "speak" not in verbs


def test_an_offer_is_an_id_a_label_in_both_languages_and_the_fields_of_the_action():
    game = talking("li_da")
    know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    for verb in ("tell", "entrust", "promise"):
        for offer in offered(game, verb):
            assert set(offer) in ({"id", "label", "body"}, {"id", "label", "body", "lie"})
            assert ("lie" in offer) == offer["id"].endswith(":as_seen")
            assert (
                set(offer["label"]) == {"zh", "en"}
                and offer["label"]["zh"]
                and offer["label"]["en"]
            )
            assert isinstance(offer["body"], dict) and "type" not in offer["body"]
    assert len({o["id"] for o in offered(game, "tell")}) == len(offered(game, "tell"))


def test_every_offer_is_an_action_the_core_takes_and_none_is_refused_as_malformed():
    game = talking("li_da")
    trust(game, "li_da", 60)
    know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    know(game, "pr_boat_scratched")
    for verb in ("tell", "entrust", "promise"):
        for offer in offered(game, verb):
            out = act(game, verb, **offer["body"])  # no InputError, whatever the answer
            (result,) = acks(out)
            assert result[0] in ("applied", "rejected"), (verb, offer["id"])
            if verb == "tell":
                assert result == ("applied", None), offer["id"]


def test_the_ways_of_telling_offered_for_an_entry_are_those_that_differ_from_the_page_s_own():
    game = talking("li_da")
    heard = know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    seen = know(game, "pr_rail_located")  # nothing heavier than where it is
    own = know(game, "pr_boat_scratched")
    tell = ids(game, "tell")
    # a player tells a thing as it is, or says it was seen: what was only heard, said as if seen, is
    # a lie about the source, and the offer says so
    assert [i for i in tell if i.startswith(heard["id"])] == [
        f"{heard['id']}:faithful",
        f"{heard['id']}:as_seen",
    ]
    assert [i for i in tell if i.startswith(seen["id"])] == [f"{seen['id']}:faithful"]
    assert [i for i in tell if i.startswith(own["id"])] == [f"{own['id']}:faithful"]
    by_id = {o["id"]: o for o in offered(game, "tell")}
    assert by_id[f"{heard['id']}:as_seen"]["lie"] is True
    assert "lie" not in by_id[f"{heard['id']}:faithful"]
    assert by_id[f"{heard['id']}:as_seen"]["body"] == {"entry": heard["id"], "how": "as_seen"}
    assert by_id[f"{seen['id']}:faithful"]["body"] == {"entry": seen["id"], "how": "faithful"}
    # nothing is made up, told with more drama or told without its source: the core takes all five
    # ways of telling (and the bots use them), but the town puts forward these two
    assert not [i for i in tell if i.startswith("fab:") or i.endswith((":sharpen", ":hide_source"))]
    label = by_id[f"{heard['id']}:as_seen"]["label"]
    assert label["zh"].startswith("说成我亲眼看见的：")
    assert label["en"].startswith("Say I saw it myself")
    assert by_id[f"{heard['id']}:faithful"]["label"]["zh"].startswith("照实说：")


def test_the_ways_of_telling_are_named_in_the_list_as_the_page_names_them():
    game = talking("li_da")
    heard = know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    sentence = notebook.sentence(notebook.view(state_of(game)["social"])[heard["prop"]])
    labels = {o["id"]: o["label"] for o in offered(game, "tell")}
    for how, key in (("faithful", "say.faithful"), ("as_seen", "say.asSeen")):
        label = labels[f"{heard['id']}:{how}"]
        for lang, table in (("en", WEB_EN), ("zh", WEB_ZH)):
            name = re.search(rf'"{key}": "([^"]+)"', table).group(1)
            separator = ": " if lang == "en" else "："
            assert label[lang] == name + separator + sentence[lang], (how, lang)


def test_the_offers_of_telling_are_made_once_for_a_notebook_and_made_again_when_it_changes():
    game = talking("li_da")
    know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    first = offers.tell(state_of(game))
    assert offers.tell(state_of(game)) is first
    know(game, "pr_li_damaged", "heard", "cha_laoban")
    assert offers.tell(state_of(game)) is not first
    assert len(offers.tell(state_of(game))) > len(first)


def test_the_offers_kept_for_a_notebook_do_not_leak_into_another_game_that_reads_an_id_otherwise():
    labels = []
    for who in ("li_er", "zhou_dalang"):
        game = talking("li_da")
        state_of(game)["social"]["props"]["pr_x__as"] = f"damaged|what:t_rail,who:{who}||0|||"
        know(game, "pr_x__as", "heard", "cha_laoban")
        labels.append(offered(game, "tell")[0]["label"]["en"])
    assert labels[0].endswith("Li Er broke the bridge railing.")
    assert labels[1].endswith("Zhou Dalang broke the bridge railing.")


@pytest.mark.parametrize(
    ("who", "hour", "kinds"),
    [
        ("li_da", 10, {"material", "join"}),
        ("zhou_zhanggui", 10, {"material", "join"}),
        ("miaozhu", 10, {"lane", "testify", "join"}),
        ("li_laotai", 10, {"lend", "join"}),
        ("zuzhang", 10, {"convene", "join"}),
        ("gengfu", 15, {"testify", "join"}),
        ("cha_laoban", 10, {"join"}),
        ("mujiang", 10, {"join"}),
    ],
)
def test_what_a_person_can_be_asked_is_what_the_town_can_do_with_them(who, hour, kinds):
    game = talking(who, hour=hour)
    got = {o["body"]["kind"] for o in offered(game, "entrust")}
    assert got == kinds | {"persuade"}  # and every one of them has an acquaintance to talk round


@pytest.mark.parametrize(
    ("who", "hour"),
    [
        ("li_da", 10),
        ("zhou_zhanggui", 10),
        ("miaozhu", 10),
        ("li_laotai", 10),
        ("zuzhang", 10),
        ("gengfu", 15),
        ("cha_laoban", 10),
        ("zhou_huoji", 10),
    ],
)
def test_the_offers_name_the_person_asked_and_never_say_他_or_她_or_对方(who, hour):
    """A label says whom it asks or promises by name, in both languages, so that the talk log reads
    "你请李大把竹料送到桥边" and not "你请对方…". The cast has fixed sexes but the names make a
    pronoun needless, and the offers of the list are all worded alike."""
    game = talking(who, hour=hour)
    name = lore().names[who]
    labelled = [o["label"] for verb in ("entrust", "promise") for o in offered(game, verb)]
    assert labelled
    for label in labelled:
        assert name["zh"] in label["zh"] and name["en"] in label["en"], label
        assert not any(word in label["zh"] for word in ("他", "她", "对方")), label
        assert not any(word in label["en"].split() for word in ("them", "he", "she")), label
    if who == "miaozhu":
        english = [
            o["label"]["en"] for o in offered(game, "entrust") if o["body"]["kind"] == "lane"
        ]
        assert english == ["Ask the Temple Keeper to open the lane behind the temple"]


def test_a_person_can_be_asked_to_talk_the_acquaintances_who_have_not_joined_round():
    game = talking("zhou_huoji")
    persuade = [o for o in offered(game, "entrust") if o["body"]["kind"] == "persuade"]
    targets = [o["body"]["target"] for o in persuade]
    assert targets[:3] == ["zhou_zhanggui", "zhou_niangzi", "zhou_dalang"] and len(targets) <= 8
    assert persuade[0]["label"]["en"] == "Ask Zhou's Clerk to talk Shopkeeper Zhou round"
    assert persuade[0]["label"]["zh"] == "请周家伙计去劝周掌柜"
    trust(game, "zhou_huoji", 90)
    row = state_of(game)["social"]["bonds"]["zhou_zhanggui"]
    row[4 * CAST.index["zhou_huoji"] + bonds.TRUST] = 90  # he trusts his clerk, who is of his house
    act(game, "entrust", kind="persuade", target="zhou_zhanggui")
    now = [o["body"]["target"] for o in offered(game, "entrust") if o["body"]["kind"] == "persuade"]
    assert "zhou_zhanggui" not in now  # he has joined


def test_what_is_left_to_promise_is_offered_and_what_is_open_to_this_person_to_be_kept():
    game = talking("cha_laoban")
    promise = {o["id"]: o["body"] for o in offered(game, "promise")}
    assert list(promise) == [
        "stall:front",
        "stall:back",
        "role:t_honor_light",
        "role:lead_lanterns",
        "role:stage_words",
        "wage:10",
        "wage:20",
        "slot:1",
    ]
    assert promise["stall:front"] == {"op": "make", "due": 3, "what": "stall", "item": "front"}
    assert promise["wage:20"] == {"op": "make", "due": 3, "what": "wage", "amount": 20}
    act(game, "promise", **promise["stall:front"])
    act(game, "promise", **promise["stall:front"])  # both front stalls
    act(game, "promise", **promise["role:t_honor_light"])
    again = {o["id"]: o["body"] for o in offered(game, "promise")}
    assert "stall:front" not in again and "role:t_honor_light" not in again
    assert again["keep:k1"] == {"op": "keep", "id": "k1"} and "keep:k3" in again
    assert list(again)[-3:] == ["keep:k1", "keep:k2", "keep:k3"]
    # an offer to keep a promise says what was promised, and never the number the core keeps it by
    labels = {o["id"]: o["label"] for o in offered(game, "promise")}
    assert labels["keep:k1"] == {
        "zh": "兑现许诺，给茶馆老板娘灯会上的前排摊位",
        "en": "Keep your promise to the Teahouse Keeper: a front-row stall at the festival",
    }
    assert labels["keep:k3"]["en"] == (
        "Keep your promise to the Teahouse Keeper: the role of honour of lighting the main lantern"
    )
    assert offered(talking("li_er"), "promise")[-1]["id"] == "slot:1"


def test_the_due_day_offered_is_two_days_on_and_never_past_the_festival():
    game = talking("cha_laoban", day=4, hour=9)
    assert {o["body"]["due"] for o in offered(game, "promise") if o["body"]["op"] == "make"} == {5}
    game = talking("cha_laoban", day=2, hour=9)
    assert {o["body"]["due"] for o in offered(game, "promise") if o["body"]["op"] == "make"} == {4}


# ------------------------------------------------------------------------------ the topics


def topics_of(game):
    return step(game)["frame"]["player"]["topics"]


def test_the_topics_are_the_whole_list_in_a_talk_and_empty_away_from_one():
    assert topics_of(bridge(1, **CLEAR)) == []
    game = talking("li_da")
    got = topics_of(game)
    assert got
    plain(got)
    assert json.loads(canon.dumps_str(got)) == got
    for topic in got:
        assert set(topic) == {"id", "kind", "label"} and topic["kind"] in offers.TOPIC_KINDS
        assert set(topic["label"]) == {"zh", "en"}
        assert topic["label"]["zh"] and topic["label"]["en"]
    assert len({t["id"] for t in got}) == len(got)
    act(game, "leave")
    assert topics_of(game) == []


def test_the_topics_are_the_entries_then_the_things_the_bridge_and_the_people_the_script_names():
    game = talking("li_da")
    know(game, "pr_boat_scratched")
    know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    frame = step(game)["frame"]
    got = [t for t in frame["player"]["topics"] if t["kind"] != "taste"]
    asked_about = [t["id"] for t in frame["player"]["topics"] if t["kind"] == "taste"]
    assert asked_about == ["likes:li_er", "likes:zhou_zhanggui"]  # people the notes name
    registry = lore().book.registry
    things = [e.id for e in registry.of_type("thing")]
    people = [p for p in CAST.index if registry.get(p) is not None]
    assert [t["id"] for t in got] == ["n1", "n2", *things, "p_bridge", *people]
    assert [t["kind"] for t in got] == (
        ["entry"] * 2 + ["thing"] * len(things) + ["place"] + ["person"] * len(people)
    )
    assert [t for t in got if t["kind"] == "entry"] == [
        {"id": e["id"], "kind": "entry", "label": e["text"]} for e in frame["notebook"]
    ]
    names = {p.id: {"zh": p.zh, "en": p.en} for p in CAST.people}
    assert [t["label"] for t in got if t["kind"] == "person"] == [names[p] for p in people]
    assert {t["id"]: t["label"] for t in got}["p_bridge"] == {"zh": "石桥", "en": "Stone Bridge"}
    assert {t["id"]: t["label"] for t in got}["t_rail"] == {
        "zh": "栏杆",
        "en": "Stone Bridge Railing",
    }
    scene = json.loads(game.scene_json())
    assert [t["label"] for t in got if t["kind"] == "thing"] == [
        {"zh": t["zh"], "en": t["en"]} for t in scene["player"]["things"]
    ]  # the names of the scene, which the page shows elsewhere


def test_the_list_leaves_out_the_person_of_the_cast_whom_the_script_does_not_name():
    game = talking("li_da")
    ids = {t["id"] for t in topics_of(game)}
    assert "shitou" in CAST.index and lore().book.registry.get("shitou") is None
    assert "shitou" not in ids
    assert ack(act(game, "ask", topic="shitou")) == ("rejected", "unknown_topic")
    assert {"li_da", "li_er", "old_he"} <= ids  # the partner too: the core answers about anyone


def test_the_core_answers_every_topic_and_every_name_of_the_scene_that_it_answers_is_a_topic():
    game = talking("li_da")
    trust(game, "li_da", 60)
    know(game, "pr_boat_scratched")
    know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    every = [t["id"] for t in topics_of(game)]
    for topic_id in every:
        assert ack(act(game, "ask", topic=topic_id)) == ("applied", None), topic_id
    got = [i for i in every if not i.startswith("likes:")]
    scene = json.loads(game.scene_json())
    named = [p["id"] for p in scene["cast"]] + [t["id"] for t in scene["player"]["things"]]
    named.append("p_bridge")
    assert set(got) < set(named) | {"n1", "n2"}
    for topic_id in named:
        result = ack(act(game, "ask", topic=topic_id))
        assert (result == ("applied", None)) == (topic_id in got), topic_id
        assert result in (("applied", None), ("rejected", "unknown_topic"))


def test_the_topics_follow_the_notebook_and_the_standing_ones_are_made_once():
    game = talking("li_da")
    first = [t for t in topics_of(game) if t["kind"] != "taste"]
    assert not [t for t in first if t["kind"] == "entry"]
    act(game, "ask", topic="p_bridge")  # the manager writes down what they are told
    again = [t for t in topics_of(game) if t["kind"] != "taste"]
    entries = [t["id"] for t in again if t["kind"] == "entry"]
    assert entries == ["n1"] and len(again) == len(first) + 1
    assert [t for t in again if t["kind"] != "entry"] == first
    world = world_of(game)
    assert offers.topics(world, [])[0] is offers.topics(world, [])[0]  # the same dicts each time
