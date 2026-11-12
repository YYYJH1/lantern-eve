"""The manager's part of the reveal: every chain of the notebook, and how far their words went."""

import json

import persuade_driver as driver
from bridge_helpers import CAST, CLEAR, bridge, run_to, state_of, step
from dealings_helpers import act, believe, events, know, talking, tell, trust
from goals_helpers import Hand
from player_helpers import doc_scene, plain, seed_of

from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import notes, repute, reveal
from lantern_core.world.bridge.lore import PLAYER

LISTENER = "cha_laoban"
CAST_ORDER = list(CAST.index)


def reveal_of(game):
    return reveal.ending_reveal(state_of(game))


def entry_of(data, entry_id):
    return next(e for e in data["entries"] if e["id"] == entry_id)


# ------------------------------------------------------------------------------ the entries


def test_every_entry_of_the_notebook_has_the_whole_chain_the_game_never_showed():
    game = doc_scene(seed=2)
    act(game, "talk", npc="zhou_zhanggui")
    act(game, "ask", topic="pr_liner_damaged")
    data = reveal_of(game)
    (entry,) = data["entries"]
    assert (entry["id"], entry["prop"], entry["source"], entry["hand"]) == (
        "n1",
        "pr_liner_damaged",
        "heard",
        2,
    )
    assert entry["true"] is False  # nobody did it but the one the truth names
    holders = [
        (h["holder"], h["how"], h["told_by"], h["claim"], h["path"], h["op"])
        for h in entry["chain"]
    ]
    assert holders == [
        (PLAYER, "heard", "zhou_zhanggui", "p1", "belief", ""),
        ("zhou_zhanggui", "inferred", "", "c2", "mutation", "assimilate"),  # where it changed shape
        ("zhou_zhanggui", "heard", "zhou_huoji", "c1", "belief", ""),
        ("zhou_huoji", "saw", "", "", "", ""),
    ]
    assert (entry["end"], entry["origin"]) == ("saw", "zhou_huoji")
    # each hop says which version of the story the holder held there, and the reveal has its words
    assert [h["prop"] for h in entry["chain"]] == [
        "pr_liner_damaged",
        "pr_liner_damaged",
        "pr_liner_at_bridge",
        "pr_liner_at_bridge",
    ]
    assert data["texts"]["pr_liner_at_bridge"] == {
        "zh": "李二昨晚在桥边。",
        "en": "Li Er was at the bridge last night.",
    }
    assert {h["prop"] for h in entry["chain"]} <= set(data["texts"])
    # the game showed the manager none of this until they had asked
    shown = [e for e in step(game)["frame"]["notebook"] if e["id"] == "n1"][0]
    assert [name["id"] for name in shown["chain"] if name] == ["zhou_zhanggui"]


def test_what_the_manager_saw_is_a_chain_of_one_and_what_a_witness_told_ends_with_the_witness():
    game = talking("miaozhu", seed=seed_of("v_flood"), hour=9, day=4)
    seen = know(game, "pr_boat_scratched")
    trust(game, "miaozhu", 30)
    act(game, "entrust", kind="testify")
    data = reveal_of(game)
    own = entry_of(data, seen["id"])
    assert [h["holder"] for h in own["chain"]] == [PLAYER] and own["end"] == "saw"
    assert own["source"] == "seen" and own["true"] is True  # the scratches are real
    told = entry_of(data, "n2")
    assert told["prop"] == "pr_he_home" and told["source"] == "heard" and told["true"] is True
    assert [(h["holder"], h["how"]) for h in told["chain"]] == [
        (PLAYER, "heard"),
        ("miaozhu", "saw"),
    ]
    assert (told["end"], told["origin"]) == ("saw", "miaozhu")
    assert told["chain"][0]["claim"].startswith(
        "p"
    )  # what he said to the manager, kept as answers are


def test_an_entry_that_tells_the_truth_without_its_hour_is_true_and_one_that_names_another_is_not():
    game = talking(LISTENER, seed=seed_of("v_boat"), hour=9)
    props = state_of(game)["social"]["props"]
    for prop_id, who in (("m_loose", "old_he"), ("m_other", "zhou_dalang")):
        loose = Prop.of(prop_id, "damaged", {"who": who, "what": "t_rail"})  # no hour, no reason
        props[prop_id] = notes.encode_prop(loose)
    told = know(game, "m_loose", "heard", "li_er")
    other = know(game, "m_other", "heard", "li_er")
    data = reveal_of(game)
    assert entry_of(data, told["id"])["true"] is True
    assert entry_of(data, other["id"])["true"] is False


def test_an_entry_about_the_manager_is_one_the_story_has_no_truth_for():
    game = talking(LISTENER)
    repute.prop(state_of(game)["social"], repute.LIED)
    gossip = know(game, repute.LIED, "heard", "li_er")
    plain_one = know(game, "pr_liner_looking")
    data = reveal_of(game)
    assert entry_of(data, gossip["id"])["true"] is None
    assert entry_of(data, plain_one["id"])["true"] is True


def test_what_the_manager_made_up_is_not_an_entry_of_the_notebook():
    game = talking(LISTENER)
    out = tell(game, how="fabricate", pred="at", subject="li_er", object="p_bridge", neg=True)
    assert events(out, "told")[0]["outcome"] == "took"
    assert reveal_of(game)["entries"] == [] and len(reveal_of(game)["spoke"]["told"]) == 1


# ------------------------------------------------------------------------------ their words


def test_the_reveal_counts_what_the_manager_told_in_what_way_and_how_much_of_it_was_a_lie():
    game = talking(LISTENER)
    trust(game, LISTENER, 40)
    seen = know(game, "pr_boat_scratched")
    heard = know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    tell(game, seen["id"], "faithful")
    tell(game, heard["id"], "as_seen")
    tell(game, heard["id"], "sharpen")
    tell(game, how="fabricate", pred="at", subject="li_er", object="p_bridge", neg=True)
    data = reveal_of(game)["spoke"]
    assert data["tellings"] == 4 and data["lies"] == 2
    assert data["ways"] == {"as_seen": 1, "fabricate": 1, "faithful": 1, "sharpen": 1}
    assert [row[3] for row in data["told"]] == ["faithful", "as_seen", "sharpen", "fabricate"]
    assert [row[4] for row in data["told"]] == [0, 1, 0, 1]
    assert data["reached"] == [LISTENER] and data["furthest"] == 1 and data["retold"] == 0
    assert data["caught"] == []


def test_the_reveal_follows_the_words_of_the_manager_to_whoever_the_town_carried_them_to():
    game = talking(LISTENER)
    trust(game, LISTENER, 90)
    seen = know(game, "pr_boat_scratched")
    tell(game, seen["id"], "faithful")
    act(game, "leave")
    social_state = state_of(game)["social"]
    social_state["next"] = [0] * len(social_state["next"])
    for _ in range(2500):
        step(game)
    data = reveal_of(game)["spoke"]
    assert LISTENER in data["reached"] and len(data["reached"]) >= 2
    assert data["furthest"] >= 2 and data["retold"] >= 1
    assert data["reached"] == [p for p in CAST_ORDER if p in data["reached"]]  # in cast order


def test_what_the_town_said_of_the_manager_is_in_the_reveal_with_who_said_it_to_whom():
    game = talking(LISTENER)
    trust(game, LISTENER, 40)
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")
    tell(game, how="fabricate", pred="damaged", subject="zhou_dalang", object="t_rail")
    act(game, "leave")
    social_state = state_of(game)["social"]
    social_state["next"] = [0] * len(social_state["next"])
    for _ in range(6000):  # the town tells a story about once in a game day, so it takes a while
        step(game)
    data = reveal_of(game)
    said = data["said_of_me"]
    assert said and all(row[3] == "m_lied" for row in said)
    assert said[0][1] == LISTENER  # she was the first to say it
    assert [row[:2] for row in data["spoke"]["caught"]] == [
        ["fab__damaged__zhou_dalang__t_rail", LISTENER]
    ]
    assert data["texts"]["m_lied"] == {"zh": "总管撒了谎。", "en": "The Festival Manager lied."}


# ------------------------------------------------------------------------------ the rest of it


def test_the_reveal_also_has_the_promises_the_trust_the_stars_and_the_words_for_every_prop():
    game = talking(LISTENER)
    act(game, "promise", what="slot", item="1", due=2)
    know(game, "pr_boat_scratched")
    data = reveal_of(game)
    assert data["pledges"] == [["k1", LISTENER, "slot", "1", 2, "open"]]
    assert [row[0] for row in data["trust"]][:3] == ["li_laotai", "li_da", "li_er"]
    assert dict(map(tuple, data["trust"]))[LISTENER] == 10 + 3 + 4  # a talk, and a promise
    assert data["stars"] == 0 and set(data) == {
        "entries",
        "spoke",
        "said_of_me",
        "pledges",
        "trust",
        "stars",
        "texts",
    }
    assert data["texts"]["pr_boat_scratched"]["en"] == "The boat has fresh scratches."
    plain(data)
    assert json.loads(json.dumps(data)) == data


def test_a_game_that_ends_hands_the_reveal_to_the_ending_under_the_name_of_the_player():
    game = bridge(3, days=1, **CLEAR)
    run_to(game, 600)
    know(game, "pr_boat_scratched")
    hand = Hand(game)
    hand.run_to(1830)
    (ending,) = [e for e in hand.events if e["kind"] == "ending"]
    mine = ending["reveal"]["player"]
    assert [e["prop"] for e in mine["entries"]] == ["pr_boat_scratched"]
    assert mine["spoke"]["tellings"] == 0 and mine["stars"] == 0
    assert state_of(game)["goals"]["ending"]["reveal"]["player"] == mine
    plain(game._kernel.state)


def test_a_world_without_the_talk_between_neighbours_has_nothing_to_reveal():
    game = bridge(1)
    data = reveal.ending_reveal({**state_of(game), "social": {}})
    assert data == {}


# ------------------------------------------------------------------------------ in both languages


def strays(data, path=()):
    """The texts in Chinese that stand outside a ``{"zh", "en"}`` pair, anywhere in plain data."""
    if isinstance(data, dict):
        if set(data) == {"zh", "en"}:
            return
        for key, value in data.items():
            yield from strays(value, (*path, key))
    elif isinstance(data, list):
        for i, value in enumerate(data):
            yield from strays(value, (*path, i))
    elif isinstance(data, str) and any("\u4e00" <= char <= "\u9fff" for char in data):
        yield path, data


def test_a_game_played_by_the_manager_ends_with_a_reveal_that_is_said_in_both_languages():
    run = driver.Driver(restores=False)
    found = []
    while run.game.tick < driver.TICKS:
        run.call()
        found += events(run.last, "ending")
    (event,) = found
    reveal = event["reveal"]
    assert (
        reveal["player"]["entries"] and reveal["player"]["spoke"]["tellings"] == 2
    )  # the watchman, the boatman
    assert list(strays(reveal)) == []  # nothing in the reveal is in one language only
    (chain,) = reveal["chains"]
    assert chain["label"]["en"].startswith("From ") and chain["label"]["zh"].startswith("从")
    assert set(chain["texts"]) == {row[0] for row in chain["planted"]}
    # every hop of every chain of the notebook says which version it held, and the words are there
    texts = reveal["player"]["texts"]
    hops = [hop for entry in reveal["player"]["entries"] for hop in entry["chain"]]
    assert hops and all(hop["prop"] in texts for hop in hops)
    assert {entry["prop"] for entry in reveal["player"]["entries"]} <= set(texts)
    # and the game still has all of it, while the frames after the call that made it carry the rest
    assert json.loads(run.game.ending_json()) == event
    assert run.last["frame"]["ending"] == {
        k: v for k, v in event.items() if k not in ("reveal", "epilogue")
    }
    plain(event)
