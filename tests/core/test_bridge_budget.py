"""The budget gate: reserve and settle, three stages, the walk down the tiers, host events."""

import json

import pytest
from bridge_helpers import bridge
from gate_helpers import (
    ROUND_PRICES,
    Wire,
    ask,
    budget_of,
    goals_of,
    install,
    plan_at,
    plan_every,
)
from hypothesis import given, settings
from hypothesis import strategies as st

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.inputs import HOST_EVENTS, InputError
from lantern_core.replay import Recorder, fork, rebuild
from lantern_core.rng import Pcg32
from lantern_core.world.bridge import budget, pricing
from lantern_core.world.bridge.world import DEFAULT_CONFIG

CAP = 5_000_000
# A request of 16,000 input tokens and 4,000 output ones. At one
# micro-yuan per token on the cheap tier it holds 0.02 yuan, and at five on the strong one 0.10.
BIG = {"size": 15_996, "max_tokens": 4_000}


def game_with(monkeypatch, plan, seed=1, **config):
    """A bridge game with the stand-in asking by ``plan``, on round prices unless told otherwise."""
    install(monkeypatch, plan)
    return bridge(seed, **{"budget_cap": CAP, **ROUND_PRICES, **config})


def only_request(out):
    (request,) = out["requests"]
    return request


# ------------------------------------------------------------------------------ prices and stages


def test_a_call_costs_its_tokens_at_the_price_of_its_tier_rounded_up_in_each_part():
    config = DEFAULT_CONFIG
    assert pricing.cost(config, "cheap", 1000, 0) == 150  # 0.15 yuan a million tokens in
    assert pricing.cost(config, "cheap", 0, 1000) == 1_500
    assert pricing.cost(config, "strong", 1000, 1000) == 800 + 8_000
    assert pricing.cost(config, "cheap", 1, 0) == 1  # 0.15 micro-yuan, rounded up
    assert pricing.cost(config, "cheap", 0, 1) == 2  # 1.5 micro-yuan, rounded up
    assert pricing.cost(config, "cheap", 1, 1) == 3  # the parts are rounded one by one
    assert pricing.cost(config, "cheap", 0, 0) == 0
    assert pricing.cost(config, "local", 10**9, 10**9) == 0
    assert pricing.cost(config, "template", 10**9, 10**9) == 0


def test_a_larger_call_never_costs_less():
    # this is what makes the reservation a bound on what a result can cost
    for tier in ("cheap", "strong"):
        last = 0
        for tokens in range(0, 5_000, 7):
            now = pricing.cost(DEFAULT_CONFIG, tier, tokens, tokens // 3)
            assert now >= last
            last = now


def test_the_stages_begin_at_seventy_and_ninety_percent_of_the_cap():
    cap = 1_000
    assert [pricing.stage_of(o, cap) for o in (0, 1, 699)] == [pricing.NORMAL] * 3
    assert [pricing.stage_of(o, cap) for o in (700, 701, 899)] == [pricing.NO_STRONG] * 3
    assert [pricing.stage_of(o, cap) for o in (900, 901, 1_000, 5_000)] == [pricing.NO_CLOUD] * 4
    # a cap that does not divide evenly: 70 percent of 3 is 2.1 and 90 percent is 2.7
    assert [pricing.stage_of(o, 3) for o in range(5)] == [0, 0, 0, 2, 2]
    assert [pricing.stage_of(o, 10) for o in range(10, 12)] == [2, 2]
    # a game with no money plays offline from the start
    assert pricing.stage_of(0, 0) == pricing.NO_CLOUD


# ------------------------------------------------------------------------------ the worked example


def test_a_strong_call_that_would_pass_the_cap_goes_cheap_and_is_admitted(monkeypatch):
    """Cap 5 yuan, occupancy 3.49: a strong call (0.10) goes cheap (0.02), admitted at 3.51."""
    game = game_with(monkeypatch, plan_at({1: [ask("strong", **BIG)]}))
    wire = Wire(game)
    wire.step()
    budget_of(game)["spent"] = 3_490_000
    assert budget.occupancy(game._kernel.state) == 3_490_000  # 69.8 percent: stage normal
    assert pricing.stage_of(3_490_000, CAP) == pricing.NORMAL
    assert pricing.cost(game._kernel.world.config, "strong", 16_000, 4_000) == 100_000
    assert pricing.cost(game._kernel.world.config, "cheap", 16_000, 4_000) == 20_000
    out = wire.step()
    request = only_request(out)
    assert (request["tier"], request["hold"]) == ("cheap", 20_000)
    assert budget.occupancy(game._kernel.state) == 3_510_000  # 70.2 percent: still the second stage
    (event,) = [e for e in out["events"] if e["kind"] == "downgrade"]
    assert event["asked"] == "strong" and event["tier"] == "cheap" and event["reason"] == "budget"
    assert event["request_id"] == request["request_id"]
    assert game.in_flight() == [request["request_id"]]
    ledger = json.loads(game.ledger_json())
    assert ledger["cheap"]["issued"] == 1 and ledger["strong"]["issued"] == 0


def test_a_strong_call_goes_out_strong_while_it_stays_in_the_first_stage(monkeypatch):
    game = game_with(monkeypatch, plan_at({1: [ask("strong", **BIG)]}))
    wire = Wire(game)
    wire.step()
    budget_of(game)["spent"] = 3_390_000  # + 0.10 = 3.49, under 70 percent
    out = wire.step()
    request = only_request(out)
    assert (request["tier"], request["hold"]) == ("strong", 100_000)
    assert not [e for e in out["events"] if e["kind"] == "downgrade"]
    assert json.loads(game.ledger_json())["strong"]["issued"] == 1


def test_the_hold_alone_can_cross_the_limit_and_a_cheaper_hold_can_bring_it_back(monkeypatch):
    game = game_with(monkeypatch, plan_at({1: [ask("strong", **BIG)]}))
    wire = Wire(game)
    wire.step()
    budget_of(game)["spent"] = (
        3_450_000  # strong: 3.55 is the second stage, cheap: 3.47 is the first
    )
    request = only_request(wire.step())
    assert (request["tier"], request["hold"]) == ("cheap", 20_000)


def test_a_cheap_call_is_turned_down_at_ninety_percent_and_goes_nowhere_without_a_local_model(
    monkeypatch,
):
    game = game_with(monkeypatch, plan_at({1: [ask("cheap", **BIG)]}))
    wire = Wire(game)
    wire.step()
    budget_of(game)["spent"] = 4_490_000  # + 0.02 = 4.51, past 90 percent of 5
    out = wire.step()
    assert out["requests"] == [] and game.in_flight() == []
    (event,) = [e for e in out["events"] if e["kind"] == "downgrade"]
    assert (event["asked"], event["tier"], event["reason"]) == ("cheap", "template", "budget")
    # the world got its outcome in the same call, as an error result with the reason as its text
    assert goals_of(game)["landed"] == [[goals_of(game)["asked"][0], "error", "budget", "template"]]
    assert budget_of(game)["templated"] == 1 and budget_of(game)["downgraded"] == 1
    assert budget_of(game)["spent"] == 4_490_000  # a template costs nothing
    ledger = json.loads(game.ledger_json())
    assert all(ledger[tier]["issued"] == 0 for tier in ("cheap", "strong", "local"))


def test_with_a_local_model_the_same_call_goes_to_it_and_costs_nothing(monkeypatch):
    game = game_with(monkeypatch, plan_at({2: [ask("strong", **BIG)]}))
    wire = Wire(game)
    wire.step()
    wire.step(wire.event("local_up"))
    budget_of(game)["spent"] = 4_490_000
    out = wire.step()
    request = only_request(out)
    assert (request["tier"], request["hold"]) == ("local", 0)
    (event,) = [e for e in out["events"] if e["kind"] == "downgrade"]
    assert (event["asked"], event["tier"], event["reason"]) == ("strong", "local", "budget")
    assert budget.occupancy(game._kernel.state) == 4_490_000
    wire.step(wire.result(request["request_id"], usage={"input_tokens": 9_000, "output_tokens": 9}))
    assert budget_of(game)["spent"] == 4_490_000
    assert json.loads(game.ledger_json())["local"]["input_tokens"] == 9_000


# ------------------------------------------------------------------------------ the walk down


TIERS = ("strong", "cheap", "local", "template")


@settings(max_examples=400, deadline=None)
@given(
    asked=st.sampled_from(TIERS[:3]),
    cloud=st.booleans(),
    local=st.booleans(),
    cap=st.integers(0, 10**7),
    occupied=st.integers(0, 2 * 10**7),
    tokens_in=st.integers(0, 10**5),
    tokens_out=st.integers(1, 4_096),
)
def test_a_request_only_moves_down_and_stops_on_the_highest_tier_that_is_open(
    asked, cloud, local, cap, occupied, tokens_in, tokens_out
):
    config = {**DEFAULT_CONFIG, "budget_cap": cap}
    section = {"cloud": cloud, "local": local}
    request = {"tier": asked, "reserve": {"input_tokens": tokens_in, "output_tokens": tokens_out}}
    tier, hold, why = budget.decide(config, section, occupied, request)
    assert TIERS.index(tier) >= TIERS.index(asked)  # never up
    assert hold == pricing.cost(config, tier, tokens_in, tokens_out)
    assert (why is None) == (tier == asked)
    assert why in (None, "budget", "cloud_down", "local_down")
    at = pricing.stage_of(occupied + hold, cap)
    if tier in ("strong", "cheap"):  # it went out on the cloud, so the cloud is up and it fits
        assert cloud and (at == pricing.NORMAL or (at == pricing.NO_STRONG and tier == "cheap"))
    if tier == "local":
        assert local
    # nothing between the tier asked for and the tier given was open
    for between in TIERS[TIERS.index(asked) : TIERS.index(tier)]:
        cost = pricing.cost(config, between, tokens_in, tokens_out)
        at_between = pricing.stage_of(occupied + cost, cap)
        assert budget._refusal(between, at_between, section) is not None
    assert budget.decide(config, section, occupied, request) == (tier, hold, why)  # one outcome


def test_the_reason_is_the_first_thing_that_closed_the_tier_asked_for():
    config = {**DEFAULT_CONFIG, "budget_cap": CAP, **ROUND_PRICES}
    request = {"tier": "strong", "reserve": {"input_tokens": 16_000, "output_tokens": 4_000}}
    up = {"cloud": True, "local": True}
    down = {"cloud": False, "local": True}
    assert budget.decide(config, up, 0, request) == ("strong", 100_000, None)
    assert budget.decide(config, down, 0, request) == ("local", 0, "cloud_down")
    assert budget.decide(config, {"cloud": False, "local": False}, 0, request) == (
        "template",
        0,
        "cloud_down",
    )
    assert budget.decide(config, up, 4_600_000, request) == ("local", 0, "budget")
    asking_local = {**request, "tier": "local"}
    assert budget.decide(config, up, 4_600_000, asking_local) == ("local", 0, None)
    assert budget.decide(config, {"cloud": True, "local": False}, 0, asking_local) == (
        "template",
        0,
        "local_down",
    )


def test_the_stages_follow_the_money_through_a_run_of_settled_calls(monkeypatch):
    # a strong call asked on every odd tick up to 11, and each one answered in the call after it
    # with the most it can have used. A cheap call holds 10,000 and a strong one 50,000.
    big = {"size": 5_996, "max_tokens": 4_000}
    game = game_with(monkeypatch, plan_every(2, ask("strong", **big), last=11), budget_cap=100_000)
    wire = Wire(game)
    tiers, stages, answers = [], [], []
    for _ in range(16):
        out = wire.step(*[wire.result(r["request_id"], usage=r["reserve"]) for r in answers])
        answers = out["requests"]
        tiers += [r["tier"] for r in answers]
        for event in out["events"]:
            if event["kind"] == "budget_stage":
                stages.append((out["tick"], event["previous"], event["stage"]))
    # tick 1: 0.05 makes 50,000, strong. Tick 3: strong would make 100,000, cheap makes 60,000.
    # Ticks 5 and 7: cheap makes 70,000 and 80,000, in the second stage. Tick 9: cheap would make
    # 90,000, the end of the cloud, and the asks of ticks 9 and 11 get template lines.
    assert tiers == ["strong", "cheap", "cheap", "cheap"]
    assert budget_of(game)["spent"] == 80_000 and budget.occupancy(game._kernel.state) == 80_000
    landed = goals_of(game)["landed"]
    assert [row[1:] for row in landed if row[3] == "template"] == [
        ["error", "budget", "template"]
    ] * 2
    assert budget_of(game)["templated"] == 2 and budget_of(game)["downgraded"] == 5
    assert stages == [(5, 0, 1)]  # the occupancy reaches 70,000 at the end of tick 5, once


# ------------------------------------------------------------------------------ settling


def settled_game(monkeypatch, *, tier="cheap", **config):
    """A game with one call of 10,000 tokens in flight on the cheap tier (50,000 on the strong).

    Returns the game, its wire and the request.
    """
    plan = plan_at({1: [ask(tier, size=5_996, max_tokens=4_000)]})
    game = game_with(monkeypatch, plan, **config)
    wire = Wire(game)
    wire.step()
    return game, wire, only_request(wire.step())


def test_a_result_is_charged_for_what_it_used_and_the_hold_is_released(monkeypatch):
    game, wire, request = settled_game(monkeypatch)
    assert request["hold"] == 10_000 and budget.occupancy(game._kernel.state) == 10_000
    wire.step(wire.result(request["request_id"], usage={"input_tokens": 600, "output_tokens": 50}))
    assert budget_of(game)["spent"] == 650  # at one micro-yuan a token
    assert budget.held(game._kernel.state) == 0 and game.in_flight() == []
    assert budget.occupancy(game._kernel.state) == 650


@pytest.mark.parametrize("status", ["ok", "timeout", "cancelled", "error"])
def test_unknown_usage_is_charged_the_whole_reservation_and_not_given_back(monkeypatch, status):
    game, wire, request = settled_game(monkeypatch, tier="strong")
    assert request["hold"] == 50_000
    wire.step(wire.result(request["request_id"], status=status, usage=None, text=""))
    assert budget_of(game)["spent"] == 50_000
    ledger = json.loads(game.ledger_json())["strong"]
    assert (ledger["input_tokens"], ledger["output_tokens"]) == (6_000, 4_000)


def test_a_cancel_with_known_zero_usage_is_free_which_is_how_a_fork_leaves_the_old_branch_the_bill(
    monkeypatch,
):
    game, wire, request = settled_game(monkeypatch)
    snapshot = game.snapshot_json()
    branch, cancels = fork(snapshot)
    assert [c["body"]["request_id"] for c in cancels] == [request["request_id"]]
    assert budget.occupancy(branch._kernel.state) == 10_000  # the branch inherits the hold
    branch.step(json.dumps(cancels))
    assert budget_of(branch)["spent"] == 0 and branch.in_flight() == []
    # the old branch, whose host cannot say what the aborted call cost, pays the reservation
    wire.step(wire.result(request["request_id"], status="cancelled", usage=None, text=""))
    assert budget_of(game)["spent"] == 10_000


def test_a_late_answer_after_a_timeout_is_booked_as_unattributed_and_not_charged_again(monkeypatch):
    game, wire, request = settled_game(monkeypatch)
    wire.step(wire.result(request["request_id"], status="timeout", usage=None, text=""))
    assert budget_of(game)["spent"] == 10_000
    usage = {"input_tokens": 600, "output_tokens": 50}
    wire.step(wire.result(request["request_id"], usage=usage))  # it came after all
    assert budget_of(game)["spent"] == 10_000
    assert json.loads(game.ledger_json())["unattributed"] == {
        "results": 1,
        "input_tokens": 600,
        "output_tokens": 50,
    }


def test_a_host_that_reports_more_than_was_reserved_is_charged_what_it_reports(monkeypatch):
    # the cap rests on the host keeping to max_tokens (see budget): the core books the truth
    game, wire, request = settled_game(monkeypatch, budget_cap=100_000)
    out = wire.step(
        wire.result(request["request_id"], usage={"input_tokens": 90_000, "output_tokens": 0})
    )
    assert budget_of(game)["spent"] == 90_000  # nine times the hold
    assert out["frame"]["hud"]["stage"] == pricing.NO_CLOUD


def test_the_money_spent_stays_inside_the_integers_a_snapshot_can_carry(monkeypatch):
    game, wire, request = settled_game(
        monkeypatch, budget_cap=10**10, price_cheap_in=10**9, price_cheap_out=10**9
    )
    budget_of(game)["spent"] = pricing.MAX_SPENT - 5
    huge = {"input_tokens": 2**31, "output_tokens": 2**31}
    wire.step(wire.result(request["request_id"], usage=huge))
    assert budget_of(game)["spent"] == pricing.MAX_SPENT
    canon.check(game._kernel.state)
    assert Game.from_snapshot_json(game.snapshot_json()).hash() == game.hash()


# ------------------------------------------------------------------------------ the cap


@pytest.mark.parametrize("cap", [0, 30_000, 100_000, 3_000_000])
def test_many_requests_in_flight_at_once_cannot_push_the_spending_past_the_cap(monkeypatch, cap):
    rng = Pcg32(7, 5)
    asked = [rng.choice(("strong", "cheap", "cheap")) for _ in range(4_000)]
    sizes = [(rng.below(4_000) + 1, rng.below(1_000) + 1) for _ in range(4_000)]
    bursts = {
        t: [ask(asked[n], *sizes[n]) for n in range(t * 40 - 40, t * 40)] for t in range(1, 100)
    }
    game = game_with(monkeypatch, plan_at(bursts), budget_cap=cap)
    wire = Wire(game)
    flying: list[dict] = []
    went_out = paid = 0
    for tick in range(160):
        answers = []
        if tick >= 60:  # the host answers 30 calls a tick, each with the most it can have used
            answers = [wire.result(r["request_id"], usage=r["reserve"]) for r in flying[:30]]
            paid += sum(r["hold"] for r in flying[:30])
            del flying[:30]
        out = wire.step(*answers)
        flying += out["requests"]
        went_out += len(out["requests"])
        occupied = budget.occupancy(game._kernel.state)
        assert occupied * 100 < cap * 90 or occupied == 0  # under 90 percent, always
        assert budget_of(game)["spent"] <= cap
    assert not flying and game.in_flight() == []  # every call that went out was answered
    templated = budget_of(game)["templated"]
    assert went_out + templated == sum(len(burst) for burst in bursts.values())
    assert templated > 0  # the bursts really did meet the limit
    assert (went_out > 0) == (cap > 0)
    assert budget_of(game)["spent"] * 100 <= cap * 90
    assert (budget_of(game)["spent"] > 0) == (cap > 0)
    assert budget_of(game)["spent"] == paid  # the most a call can use costs what its hold was


def test_settling_with_less_than_the_hold_leaves_room_for_the_next_call(monkeypatch):
    eight = [ask("cheap", size=5_996, max_tokens=4_000)] * 8
    game = game_with(monkeypatch, plan_at({1: eight, 3: eight}), budget_cap=100_000)
    wire = Wire(game)
    wire.step()
    first = wire.step()["requests"]
    assert len(first) == 8  # 80,000 held: eight calls of 10,000 are the second stage, not past it
    assert budget.occupancy(game._kernel.state) == 80_000
    used = {"input_tokens": 10, "output_tokens": 5}
    wire.step(*[wire.result(r["request_id"], usage=used) for r in first])
    assert budget.occupancy(game._kernel.state) == 8 * 15
    assert len(wire.step()["requests"]) == 8


# ------------------------------------------------------------------------------ the host's events


def tier_of(out):
    """The tier of the one request of a call, or None if no request went out."""
    return out["requests"][0]["tier"] if out["requests"] else None


def test_while_the_cloud_is_down_no_cloud_tier_is_open_whatever_the_money(monkeypatch):
    asks = {tick: [ask("strong", **BIG)] for tick in (2, 4, 6, 8)}
    game = game_with(monkeypatch, plan_at(asks))
    wire = Wire(game)
    wire.step()
    wire.step(wire.event("cloud_down"))
    assert budget_of(game)["cloud"] is False
    tiers = [tier_of(wire.step())]  # tick 2: local is not there either
    wire.step(wire.event("local_up"))
    tiers.append(tier_of(wire.step()))  # tick 4
    wire.step(wire.event("cloud_up"))
    tiers.append(tier_of(wire.step()))  # tick 6
    wire.step(wire.event("local_down"))
    tiers.append(tier_of(wire.step()))  # tick 8
    assert tiers == [None, "local", "strong", "strong"]
    reasons = [row[2] for row in goals_of(game)["landed"]]
    assert reasons == ["cloud_down"]  # the one template line: asked while the cloud was down
    assert budget_of(game)["templated"] == 1 and budget_of(game)["downgraded"] == 2


def test_a_request_for_the_local_model_gets_a_template_if_there_is_none(monkeypatch):
    asks = {tick: [ask("local", size=10, max_tokens=5)] for tick in (1, 3)}
    game = game_with(monkeypatch, plan_at(asks))
    wire = Wire(game)
    wire.step()
    out = wire.step()  # no local model has been announced
    assert out["requests"] == [] and goals_of(game)["landed"][-1][2] == "local_down"
    wire.step(wire.event("local_up"))
    assert tier_of(wire.step()) == "local"


def test_every_host_event_is_taken_and_repeating_one_changes_nothing(monkeypatch):
    game = game_with(monkeypatch, plan_at({}))
    wire = Wire(game)
    for name in HOST_EVENTS:
        wire.step(wire.event(name))
        wire.step(wire.event(name))
    section = budget_of(game)
    assert (section["cloud"], section["local"]) == (True, True)  # the last of each pair
    wire.step(wire.event("cloud_down"), wire.event("local_down"))
    assert (budget_of(game)["cloud"], budget_of(game)["local"]) == (False, False)


def test_a_host_event_is_taken_while_the_world_is_paused(monkeypatch):
    game = game_with(monkeypatch, plan_at({}))
    wire = Wire(game)
    wire.step()
    wire.step(("pause", {}))
    tick = game.tick
    out = wire.step(wire.event("cloud_down"), wire.event("local_up"))
    assert out["advanced"] is False and game.tick == tick
    assert (budget_of(game)["cloud"], budget_of(game)["local"]) == (False, True)
    assert out["frame"]["hud"]["cloud"] is False  # and the frame of the paused call shows it
    wire.step(("resume", {}))
    assert game.tick == tick + 1


def drive(game, step, ticks, events):
    """Run to ``ticks``, sending the host events by tick, and return the outputs of each call.

    Every request is answered in the call after it with the most it can have used.
    """
    wire = Wire(game, step=step)
    log = []
    answers = []
    while game.tick < ticks:
        sent = [wire.event(name) for name in events.get(game.tick, ())]
        sent += [wire.result(r["request_id"], usage=r["reserve"]) for r in answers]
        out = wire.step(*sent)
        answers = out["requests"]
        log.append(out)
    return log


def decisions(log):
    """The (tick, asked, given, reason) of every request that did not go out as asked."""
    return [
        (out["tick"], e["asked"], e["tier"], e["reason"])
        for out in log
        for e in out["events"]
        if e["kind"] == "downgrade"
    ]


def tiers_of(log):
    return [(out["tick"], r["tier"]) for out in log for r in out["requests"]]


def test_the_host_events_in_a_replay_downgrade_the_game_at_the_same_ticks(monkeypatch):
    big = {"size": 5_996, "max_tokens": 4_000}
    game = game_with(monkeypatch, plan_every(25, ask("strong", **big), ask("cheap", **big)))
    events = {60: ["cloud_down"], 110: ["local_up"], 160: ["cloud_up"], 210: ["local_down"]}
    recorder = Recorder(game)
    live = drive(game, recorder.step, 300, events)
    recording = canon.loads(canon.dumps_str(recorder.recording()))  # through the file format
    assert [r[2] for r in recording["records"] if r[2] == "host"] == ["host"] * 4

    replayed = []
    again = rebuild(recording, on_step=lambda g, tick, text: replayed.append(json.loads(text)))
    assert again.hash() == game.hash()
    assert again.snapshot_json() == game.snapshot_json()
    assert len(replayed) == 300  # one call per tick
    assert decisions(replayed) == decisions(live) and tiers_of(replayed) == tiers_of(live)
    assert [e for o in replayed for e in o["events"]] == [e for o in live for e in o["events"]]
    # The asks come on ticks 1, 26, 51, ... and the events were at 60, 110, 160 and 210. Before
    # the first the asks go out as asked. With the cloud down and no local model they get template
    # lines, with a local model they go local, and once the cloud is back they go as asked again
    # (the local model going away at 210 does not matter to a cloud call).
    both = ("strong", "cheap")
    assert decisions(live) == [
        (t, a, "template", "cloud_down") for t in (76, 101) for a in both
    ] + [(t, a, "local", "cloud_down") for t in (126, 151) for a in both]
    assert tiers_of(live) == (
        [(t, tier) for t in (1, 26, 51) for tier in both]
        + [(t, "local") for t in (126, 151) for _ in both]
        + [(t, tier) for t in (176, 201, 226, 251, 276) for tier in both]
    )


def test_the_same_run_without_the_host_events_goes_differently(monkeypatch):
    big = {"size": 5_996, "max_tokens": 4_000}
    install(monkeypatch, plan_every(25, ask("strong", **big)))
    config = {"budget_cap": CAP, **ROUND_PRICES}
    told, untold = bridge(1, **config), bridge(1, **config)
    one = drive(told, Recorder(told).step, 200, {60: ["cloud_down"], 160: ["cloud_up"]})
    two = drive(untold, Recorder(untold).step, 200, {})
    assert told.hash() != untold.hash()
    assert tiers_of(one) != tiers_of(two) and decisions(two) == []


# ------------------------------------------------------------------------------ restoring


def test_a_game_restored_with_calls_in_flight_decides_and_settles_the_same_way(monkeypatch):
    big = {"size": 5_996, "max_tokens": 4_000}
    plan = plan_every(7, ask("strong", **big), ask("cheap", **big))
    game = game_with(monkeypatch, plan, budget_cap=400_000)
    wire = Wire(game)
    for _ in range(31):
        wire.step()
    assert game.in_flight() and budget.held(game._kernel.state) > 0
    restored = Game.from_snapshot_json(game.snapshot_json())
    assert restored.hash() == game.hash()
    twin = Wire(restored)
    twin.seq = wire.seq
    for tick in range(31, 140):
        timeouts = [wire.result(rid, "timeout", text="") for rid in game.in_flight()[:2]]
        left, right = wire.step(*timeouts), twin.step(*timeouts)
        assert left == right and restored.hash() == game.hash(), tick
    assert budget_of(restored) == budget_of(game) and budget_of(game)["templated"] > 0


# ------------------------------------------------------------------------------ the template line


def test_a_template_outcome_is_voided_like_a_late_result_when_its_conditions_fail(monkeypatch):
    def end_the_interaction(sim):
        sim.state["goals"]["alive"] = False  # it is over before the answer could land

    alive = [{"op": "alive"}]
    asks = {1: [ask(valid_if=alive, then=end_the_interaction)], 3: [ask(valid_if=alive)]}
    game = game_with(monkeypatch, plan_at(asks), budget_cap=0)
    wire = Wire(game)
    wire.step()
    out = wire.step()
    (void,) = [e for e in out["events"] if e["kind"] == "void"]
    assert (void["interaction_id"], void["status"], void["reason"]) == ("i1-0", "error", "invalid")
    assert goals_of(game)["landed"] == []  # it changed nothing in the world
    goals_of(game)["alive"] = True
    wire.step()
    out = wire.step()
    assert not [e for e in out["events"] if e["kind"] == "void"]
    assert [row[1:] for row in goals_of(game)["landed"]] == [["error", "budget", "template"]]


def test_the_world_gets_the_template_after_the_code_that_asked_has_returned(monkeypatch):
    seen = []

    def after(sim):
        seen.append(len(sim.state["goals"]["landed"]))

    game = game_with(monkeypatch, plan_at({1: [ask(then=after)]}), budget_cap=0)
    wire = Wire(game)
    wire.step()
    wire.step()
    assert seen == [0]  # nothing had landed yet when the asking code ran on
    assert len(goals_of(game)["landed"]) == 1


def ask_again_until(depth):
    """A handler for results that asks again for as long as fewer than ``depth`` have landed."""

    def on_land(sim, request, status, text):
        landed = len(sim.state["goals"]["landed"])
        if landed < depth:
            sim.ctx.issue(
                interaction_id=f"again-{landed}",
                tier="cheap",
                category="probe",
                messages=[{"role": "user", "content": "x"}],
                max_tokens=5,
                valid_if=[],
            )

    return on_land


def test_template_outcomes_may_ask_again_and_are_answered_in_rounds_with_a_limit(monkeypatch):
    install(monkeypatch, plan_at({1: [ask()]}), on_land=ask_again_until(5))
    game = bridge(1, budget_cap=0)
    wire = Wire(game)
    wire.step()
    wire.step()
    assert len(goals_of(game)["landed"]) == 5  # one ask, then four asked by the answers
    install(monkeypatch, plan_at({1: [ask()]}), on_land=ask_again_until(10**6))
    runaway = Wire(bridge(1, budget_cap=0))
    runaway.step()
    with pytest.raises(RuntimeError, match="keep issuing"):
        runaway.step()


# ------------------------------------------------------------------------------ the frame


def test_the_hud_shows_the_money_the_stage_and_what_the_host_said(monkeypatch):
    plan = plan_at({1: [ask("cheap", size=5_996, max_tokens=4_000)]})
    game = game_with(monkeypatch, plan, budget_cap=100_000)
    wire = Wire(game)
    quiet = {"spent": 0, "held": 0, "cap": 100_000, "stage": 0, "cloud": True, "local": False}
    assert wire.step()["frame"]["hud"]["spent"] == 0
    assert {k: v for k, v in game_hud(game).items() if k in quiet} == quiet
    out = wire.step()
    assert out["frame"]["hud"]["held"] == 10_000 and out["frame"]["hud"]["spent"] == 0
    request = only_request(out)
    out = wire.step(
        wire.result(request["request_id"], usage=request["reserve"]), wire.event("local_up")
    )
    hud = out["frame"]["hud"]
    assert {k: v for k, v in hud.items() if k in quiet} == {
        "spent": 10_000,
        "held": 0,
        "cap": 100_000,
        "stage": 0,
        "cloud": True,
        "local": True,
    }
    budget_of(game)["spent"] = 85_000
    assert wire.step()["frame"]["hud"]["stage"] == 1


def game_hud(game):
    """The hud of the frame the game would show now, without stepping it."""
    return game._kernel.world.frame(game._kernel.state)["hud"]


def stage_events(out):
    return [
        (e["previous"], e["stage"], e["spent"], e["held"], e["cap"])
        for e in out["events"]
        if e["kind"] == "budget_stage"
    ]


def test_the_stage_is_announced_once_at_the_end_of_the_tick_it_changes_in_up_and_down(monkeypatch):
    game = game_with(monkeypatch, plan_at({}), budget_cap=100_000)
    wire = Wire(game)
    wire.step()
    budget_of(game)["spent"] = 70_000
    assert stage_events(wire.step()) == [(0, 1, 70_000, 0, 100_000)]
    assert stage_events(wire.step()) == []  # not again while it stays
    budget_of(game)["spent"] = 95_000
    assert stage_events(wire.step()) == [(1, 2, 95_000, 0, 100_000)]
    budget_of(game)["spent"] = 10  # a set-up: spent never falls, but holds do, as results settle
    assert stage_events(wire.step()) == [(2, 0, 10, 0, 100_000)]


def test_a_game_with_no_money_starts_in_the_last_stage_and_says_nothing_about_it(monkeypatch):
    game = game_with(monkeypatch, plan_at({}), budget_cap=0)
    out = Wire(game).step()
    assert out["frame"]["hud"]["stage"] == 2 and budget_of(game)["stage"] == 2
    assert not [e for e in out["events"] if e["kind"] == "budget_stage"]


# ------------------------------------------------------------------------------ inputs and config


def test_a_host_input_is_validated_normalized_and_logged_as_such():
    game = bridge(1)
    wire = Wire(game)
    wire.step(("host", {"event": "local_up", "note": "ollama on 11434"}))
    assert game.last_inputs == [{"seq": 0, "kind": "host", "body": {"event": "local_up"}}]
    before = game.snapshot_json()
    for body in ({}, {"event": 5}, {"event": "cloud_sideways"}, {"event": None}, {"up": True}):
        with pytest.raises(InputError, match="event must be one of"):
            wire.step(("host", body))
        wire.seq -= 1  # a refused call does not use its numbers
    assert game.snapshot_json() == before
    with pytest.raises(InputError, match="unknown kind"):
        wire.step(("hosts", {"event": "local_up"}))


def test_the_prices_and_the_cap_are_in_the_config_and_so_in_the_header():
    game = bridge(1, budget_cap=5_000_000, price_strong_out=9_000_000)
    config = game.header()["config"]
    assert {k: v for k, v in config.items() if k.startswith(("price_", "budget_"))} == {
        "budget_cap": 5_000_000,
        "price_cheap_in": 150_000,
        "price_cheap_out": 1_500_000,
        "price_strong_in": 800_000,
        "price_strong_out": 9_000_000,
    }
    assert Game(1, "bridge", config).hash() == game.hash()
    assert DEFAULT_CONFIG["budget_cap"] == 3_000_000  # three yuan for a game of five days
    for bad in (
        {"budget_cap": -1},
        {"budget_cap": 1.5},
        {"price_cheap_in": 10**9 + 1},
        {"price_strong_in": True},
        {"price_strong_in": "5"},
    ):
        with pytest.raises(ValueError, match="must be an int"):
            bridge(1, **bad)


def test_the_local_tier_has_a_ledger_entry_like_the_others():
    ledger = json.loads(bridge(1).ledger_json())
    assert set(ledger) == {"cheap", "strong", "local", "unattributed"}
    assert ledger["local"] == ledger["cheap"] and ledger["local"]["issued"] == 0


def test_m0_has_no_gate_and_ignores_the_host_events_but_logs_them():
    event = json.dumps([{"seq": 0, "kind": "host", "body": {"event": "cloud_down"}}])
    told, untold = Game(3), Game(3)  # the m0 scenario
    assert told._kernel.gate is None
    told.step(event)
    untold.step("[]")
    assert told.last_inputs == [{"seq": 0, "kind": "host", "body": {"event": "cloud_down"}}]
    assert json.loads(told.snapshot_json())["world"] == json.loads(untold.snapshot_json())["world"]
    for _ in range(300):
        out = json.loads(told.step("[]"))
        if out["requests"]:
            break
    (request,) = out["requests"]
    assert request["hold"] == 0 and request["tier"] == "cheap"  # nothing is metered
