"""The game ``slice`` under CPython and under Pyodide in Node.

``slice_driver.run`` plays the game of ``preset("slice")`` from the dawn of the first day to the
morning of the second, 2,700 ticks: the manager asks Granny Li for the bamboo and is refused with
the words that name the rumour, walks the rumour back from the madam to the clerk, asks the clerk
three times about Li Er, asks for a hint and judges the pair it lights, and stands at the teahouse
in the evening, where it says in public that what the madam told Granny Li goes beyond what the
clerk saw (the action ``speak`` with the kind ``clarify``: each of the people there takes a stand,
Granny Li withdraws her objection) and asks Li Da, who heard it, for the bamboo. The world stands
still while the manager talks and runs fast for the minutes an act takes, so some calls simulate no
tick and the hosts must agree on those as well. The game is thrown away for one restored from its
snapshot five times: with the clerk, while the world is paying for what he was asked and once it is
paid for and the conversation holds the clock; while the speech in public is being paid for; in the
night; and on the road. In the middle of the first conversation the host also pauses the page and
resumes, and just before the first restore the core is asked for the previews of six requests to the
clerk, which must leave the hash as it was and come out the same again from the restored game. It
hashes the state after every call. The lists of hashes must be equal element by element, and so must
the digest of every output the core produced and the summary of what happened. The config of the
slice has three texts in it (the variant, the opening and the goods), which cross the boundary to
JavaScript in the snapshot and come back. The manager follows a task on the way and the core follows
the next when it is done, so the hosts must agree on the tasks and the cards as well.

The evening ends with the bamboo promised by Li Da himself (he agrees once Granny Li no longer
objects, he knows of the clarification and he trusts the manager), and the morning after has it
brought: Li Da sets out at dawn, the four poles lie at the bridge before seven, and the recap is
made at seven. The hosts must agree on the one delivery, the pile, the promise and the recap as
well.

The morning goes on with the next batch. Li Da turns the request down (the manager owes him the
favour of the first batch), a small promise to him, kept at once, moves the score, and he promises
four more. Asked again while that promise is open he says what he promised and by when, with the
amount, the item, the day and the hour put in by the core in his own words. The hosts must agree on
the two promises, the pile of eight, the words of the answer and the tasks of the bridge that the
second day brings.
"""

import pytest
import slice_driver as driver
from pyodide_runner import HERE, ROOT, build_wheel, needs_pyodide, run_pyodide

FILES = (HERE / "slice_driver.py", ROOT / "tools" / "bots" / "base.py")


def run_slice(core_args):
    return run_pyodide(
        "hashes", core_args, driver="slice_driver", files=FILES, seed=492, ticks=driver.TICKS
    )


def assert_same_run(pyodide, cpython):
    assert pyodide["python"].startswith("3.14"), pyodide["python"]
    assert pyodide["final_tick"] == cpython["final_tick"] == driver.TICKS
    # a call in a held world, and one that carries the host's pause, simulates no tick
    assert len(pyodide["hashes"]) == len(cpython["hashes"]) == driver.TICKS + 13
    for call, (theirs, ours) in enumerate(zip(pyodide["hashes"], cpython["hashes"], strict=True)):
        assert theirs == ours, f"call {call}: Pyodide {theirs}, CPython {ours}"
    assert pyodide["outputs_digest"] == cpython["outputs_digest"]
    assert pyodide["summary"] == cpython["summary"]


@pytest.fixture(scope="module")
def cpython():
    return driver.run()


def test_the_run_plays_the_first_day_of_the_slice(cpython):
    summary = cpython["summary"]
    assert summary["config"]["variant"] == "v_boat"
    assert summary["config"]["opening"] == "op_li_er_hearsay"
    assert summary["config"]["weather_heavy"] == 0
    # the way to the bamboo is shut at dawn, and in the evening Li Da, who heard it cleared, agrees
    assert summary["entrusted"] == [
        ["li_laotai", "lend", "hard", ""],
        ["li_da", "material", "agreed", ""],
        ["li_da", "material", "refused", ""],  # the next batch, before the small promise
        ["li_da", "material", "agreed", ""],  # and after it
    ]
    assert summary["restored"] == 5 and summary["restored_talking"] == 2
    assert summary["restored_owing"] == 2 and summary["restored_held"] == 1
    assert summary["restored_owing_alone"] == 1  # the speech in public, with nobody to talk to
    assert summary["host_pauses"] == 1 and summary["calls_held"] == 13
    events = summary["events"]
    assert events["talk_start"] == events["talk_end"] == 5 and events["entrusted"] == 4
    assert events["clarified"] == events["objection_withdrawn"] == 1
    # the manager's choice; the end of the lead it chose; the bamboo, which has a trail left to ask
    # along again (a judgement that holds is no task to do for it); the clearing up, whose evening
    # is on at five, the teahouse tonight, whose window is on too, and the clearing up again when
    # the hour to speak comes at six; the bamboo again when it is done (the lead on how the bridge
    # broke comes on the afternoon of the second day, so the bamboo has the night to itself); the
    # bamboo, which is at the bridge in the morning, and the core follows the rest of the bamboo,
    # which hands over to the timber while Li Da's promise is on its way, and takes the bar again
    # when the hour of the promise comes
    assert events["task_changed"] == 10
    assert [row[:3] for row in summary["changes"]] == [
        ["t_bamboo_first", "t_who_said", "chosen"],
        ["t_who_said", "t_what_proves", "done"],
        ["t_what_proves", "t_bamboo_first", "ready"],
        ["t_bamboo_first", "t_clear_rumour", "window"],
        ["t_clear_rumour", "t_tea_tonight", "window"],
        ["t_tea_tonight", "t_clear_rumour", "window"],
        ["t_clear_rumour", "t_bamboo_first", "done"],
        ["t_bamboo_first", "t_bamboo_rest", "done"],
        ["t_bamboo_rest", "t_timber", "waiting"],
        ["t_timber", "t_bamboo_rest", "window"],
    ]
    assert summary["tracked"] == "t_bamboo_rest"
    assert summary["tasks"] == {
        "t_bamboo_first": "done",  # the bamboo is at the bridge
        "t_li_da_promise": "done",  # both promises of Li Da were kept
        "t_keep_1": "done",  # and the small promise the manager made him was kept at once
        "t_who_said": "done",
        "t_what_proves": "done",  # judged
        "t_clear_rumour": "done",  # and set straight in public
        "t_tea_tonight": "done",  # the evening was spent speaking
        "t_bamboo_rest": "open",  # the bridge needs ten and has eight
        "t_timber": "open",  # the tasks that the second day brings (the lead on how the bridge
        "t_helpers": "open",  # really broke comes in the afternoon, the peace on the third day)
    }
    # n1 is the madam's version and n2 what the clerk saw: eight of the nine there took it in,
    # the shopkeeper of the Zhou house did not, and the clerk went from holding it to saying he
    # only saw Li Er at the bridge
    (claim, basis, accepted, stands) = summary["clarified"][0]
    assert (claim, basis, accepted) == ("n1", ["n2"], 8)
    assert dict((npc, (before, after)) for npc, before, after in stands) == {
        "li_laotai": ("unsure", "for"),
        "li_da": ("unsure", "for"),
        "zhou_zhanggui": ("against", "against"),
        "zhou_niangzi": ("unsure", "for"),
        "zhou_huoji": ("against", "for"),
        "cha_laoban": ("unsure", "for"),
        "sishu_xiansheng": ("unsure", "for"),
        "zuzhang": ("unsure", "for"),
        "mujiang": ("unsure", "for"),
    }
    assert summary["cards"] == [
        "li_laotai",
        "li_da",
        "li_er",
        "zhou_erlang",
        "zhou_huoji",
        "cha_laoban",
    ]
    assert events["dawn"] == events["dusk"] == events["weather"] == 1
    assert [row[:2] for row in summary["asked"]][:3] == [
        ["li_laotai", "li_er"],
        ["cha_laoban", "li_er"],
        ["cha_laoban", "pr_liner_damaged_jealous"],
    ]
    # the story is walked back to what the clerk saw himself, and the clerk's own words come after
    assert ["zhou_huoji", "pr_liner_damaged_on_purpose", "zhou_erlang"] in [
        [row[0], row[2], row[3]] for row in summary["asked"]
    ]
    assert ["zhou_huoji", "pr_liner_at_bridge", "self_seen"] in [
        [row[0], row[2], row[3]] for row in summary["asked"]
    ]
    assert summary["claims"] >= 5  # the five hops of the opening, and what was told since


def test_the_bamboo_is_promised_in_the_evening_and_brought_in_the_morning(cpython):
    summary = cpython["summary"]
    events = summary["events"]
    assert events["agreed"] == events["commitment"] == 2  # the first promise and the next batch
    assert events["task_start"] == events["taken"] == events["delivered"] == 2  # two deliveries
    promise, next_batch = summary["commitments"]
    assert (promise["id"], promise["by"], promise["state"]) == ("m1", "li_da", "delivered")
    assert (promise["item"], promise["amount"], promise["due"]) == (
        "bamboo", 4, {"day": 2, "hour": 7},
    )  # fmt: skip
    assert (next_batch["id"], next_batch["amount"], next_batch["state"]) == ("m2", 4, "delivered")
    assert summary["site"] == {"bamboo": 8, "timber": 0}
    ((tick, lines),) = summary["recap"]  # once, in the frame of the call that made it
    assert tick == 2190 and events["recap"] == 1 and len(lines) == 3
    # the delivery, which points at the promise it keeps; Granny Li, who no longer stands in the
    # way (the clarification had the same effect, but one line of that kind is enough); the promise
    delivery, withdrawn, made = lines
    assert delivery["events"] == [made["events"][0], delivery["events"][-1]]
    assert len(made["events"]) == 1 and made["events"][0] < delivery["events"][-1]
    assert withdrawn["text"]["en"] == "Granny Li has given way."
    assert len(withdrawn["events"]) == 1 and withdrawn["events"][0] < made["events"][0]


def test_the_paper_of_the_morning_and_the_summary_of_the_night_come_once_each(cpython):
    """The paper is made from the recap and the public record, so it is in the frame of the same
    call as the recap, and the summary of the night in the call that makes the first dusk. Pyodide
    must give the same words (the digest of every call holds both hosts to it)."""
    night, morning = cpython["summary"]["paper"]
    assert night[0] == 1800 and night[1] is None and night[2]["day"] == 1
    assert night[2]["changed"]["kind"] == "stance" and night[2]["blocked"] is None
    assert night[2]["step"]["id"] == "t_bamboo_first" and night[2]["step"]["window"]["day"] == 2
    assert morning[0] == 2190 and morning[2] is None
    paper = morning[1]
    assert paper["day"] == 2 and paper["head"]["kind"] == "delivery"
    assert paper["head"]["text"]["en"].startswith("The 4 poles of bamboo that Li Da promised")
    # the two short items: the people who changed their minds, and a head who stopped accusing
    assert [row["kind"] for row in paper["news"]] == ["stance", "stopped"]
    assert paper["today"] is not None and paper["today"]["window"] is not None
    assert 1 <= len(paper["talk"]) <= 2 and paper["talk"][0]["kind"].startswith("festival_")


def test_the_next_batch_is_turned_down_then_promised_and_the_same_request_names_the_promise(
    cpython,
):
    summary = cpython["summary"]
    events = summary["events"]
    assert events["pledged"] == events["pledge_kept"] == 1  # the small promise, kept at once
    # asked again while the promise is open, he says what it is, in his own words: the amount, the
    # item, and the day and the hour as a person says them on the day it is asked (the second
    # promise falls due at noon of the second day, which is the day of the question)
    ((tick, said),) = summary["answers"]
    assert tick > 2300
    (words,) = said
    assert "四根竹料" in words["zh"] and "今天中午十二点前" in words["zh"]
    assert "4 poles of bamboo" in words["en"] and "by noon today" in words["en"]
    assert "{" not in words["zh"] + words["en"]


def test_the_run_judges_and_asks_for_a_hint_and_previews_what_it_asks(cpython):
    summary = cpython["summary"]
    assert summary["events"]["judged"] == 1
    assert [row[:3] for row in summary["judgments"]] == [["n2", "n1", "unsupported"]]
    assert summary["hints"] == [{"a": "n2", "b": "n1"}]  # the pair it then judged
    marks = {row[0]: row[3] for row in summary["notebook"]}
    assert marks["n1"] == ["unsupported"] and marks["n2"] == []
    # the previews of the six requests to the clerk: the minutes the script gives each act, nothing
    # to give, and low odds that he joins
    assert summary["costs"] == [10, 10, 15, 20, 20, 20]
    assert summary["odds"] == [None, None, None, None, "low", None]
    # the clerk is out with the Zhou carts until the third day, whichever way the bridge broke, so
    # on the first day the answer is that it is not the time and not that he does not trust the
    # manager yet
    assert summary["blockers"][3] == ["This is not a good hour"]
    assert summary["blockers"][:3] == [[], [], []] and summary["blockers"][4:] == [[], []]
    assert len(summary["previews"]) == 64  # a digest of them, which the hosts must agree on
    # the tellings out of earshot are bubbles without words, and the ones in earshot have them
    assert summary["far_bubbles"] > 100 and summary["near_bubbles"] > 10


def test_restoring_from_a_snapshot_changes_nothing(cpython):
    plain = driver.run(restores=False)
    assert plain["summary"]["restored"] == 0
    assert plain["hashes"] == cpython["hashes"]
    assert plain["outputs_digest"] == cpython["outputs_digest"]
    assert plain["summary"]["final"] == cpython["summary"]["final"]


@needs_pyodide
def test_pyodide_matches_cpython_on_every_call(cpython):
    assert_same_run(run_slice(["--src", str(ROOT / "core")]), cpython)


@needs_pyodide
def test_the_wheel_loads_in_pyodide_and_gives_the_same_slice(cpython, tmp_path_factory):
    wheel = build_wheel(tmp_path_factory.mktemp("wheel"))
    assert_same_run(run_slice(["--wheel", str(wheel)]), cpython)
