"""The routine of the live test, run against a fake service so that it is known to work."""

from __future__ import annotations

import asyncio

from live_replies_helpers import MAX_CALLS, MAX_TOKENS, FakeService, live_config, play_talk


def run_routine(**kwargs):
    async def main():
        fake = await FakeService().start()
        try:
            env = {
                "LANTERN_LIVE_BASE_URL": fake.base_url,
                "DASHSCOPE_API_KEY": "sk-routine-0123456789",
            }
            config = live_config("bailian", env)
            return fake, config, await play_talk(config, env, pace=0.01, seconds=60.0, **kwargs)
        finally:
            await fake.stop()

    return asyncio.run(main())


def test_the_live_routine_plays_a_talk_within_eight_capped_calls():
    fake, config, report = run_routine()
    assert report.failure is None, report.failure
    made = [c for c in report.calls if c["code"] != "call_cap"]
    assert 0 < len(made) == len(fake.seen) <= MAX_CALLS
    assert {c["status"] for c in made} == {"ok"}
    assert all(seen["max_tokens"] <= MAX_TOKENS for seen in fake.seen)
    assert all(seen["model"] in ("qwen-flash", "qwen-plus") for seen in fake.seen)
    # an ask, a tell, a judge and the verdict, a promise: five calls, in that order
    assert [c["for"].split(":")[0].split()[-1] for c in made] == [
        "ask",
        "tell",
        "judge",
        "entrust",
        "promise",
    ]
    assert [(a[0], a[1]) for a in report.actions] == [
        ("ask", "applied"),
        ("tell", "applied"),
        ("entrust", "applied"),
        ("promise", "applied"),
    ]
    assert [a["result"] for a in report.answers] == ["line"] * 4
    assert {(a["zh"], a["en"]) for a in report.answers} == {("今天风很大。", "Windy today.")}
    assert report.ledger["cheap"]["input_tokens"] > 0
    assert report.counts["judge"] == {"asked": 1, "scored": 1, "unscored": 0}


def test_the_report_has_statuses_latencies_tokens_verdicts_and_both_languages():
    _, _, report = run_routine()
    text = "\n".join(report.lines())
    assert " ms," in text and "tokens in" in text and "gate: passed" in text
    assert "gate: judge: scored" in text
    assert "    zh: 今天风很大。" in text and "    en: Windy today." in text
    assert "ledger:" in text and "counts of the gate:" in text
    assert "sk-routine" not in text and "127.0.0.1" not in text


def test_the_cap_on_the_calls_holds_when_the_plan_would_go_past_it():
    from live_replies_helpers import PLAN

    assert len(PLAN) + 1 <= MAX_CALLS  # the plan asks for one call a step, and one more for a judge
