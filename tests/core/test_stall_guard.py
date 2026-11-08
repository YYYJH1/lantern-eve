"""The guard that ends a test which calls a held world for ever (``stall_guard``), and the drivers
that carry the same limit for a run under Pyodide, where there is no pytest to do it."""

from __future__ import annotations

import json
import time

import bridge_driver
import persuade_driver
import pytest
import slice_driver
from bridge_helpers import CLEAR, at, bridge, run_to
from player_helpers import act, beside, silence
from stall_guard import MAX_STILL


def held_game():
    """A game with the manager in a conversation: the world stands still until they act."""
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 8))
    beside(game, "cha_laoban")
    silence(game)
    act(game, "talk", npc="cha_laoban")
    assert game.paused
    return game


def test_a_loop_that_calls_a_held_world_for_ever_ends_in_a_second_with_an_error_that_says_why():
    game = held_game()
    kept = []
    started = time.time()
    with pytest.raises(AssertionError, match=f"stood still for {MAX_STILL + 1} calls"):
        while True:
            kept.append(json.loads(game.step()))
    # the call that opened the conversation was the first of the calls in a row
    assert len(kept) == MAX_STILL - 1 and time.time() - started < 30


def test_the_count_is_of_calls_in_a_row_and_starts_again_when_a_tick_is_simulated():
    game = held_game()
    for _ in range(MAX_STILL - 1):
        game.step()
    act(game, "ask", topic="p_bridge")  # the manager acts: the world runs for the minutes of it
    while game.paused is False:
        game.step()
    for _ in range(MAX_STILL - 1):  # held again, and the count began again
        game.step()


def test_the_count_is_of_each_game_and_not_of_all_of_them():
    first, second = held_game(), held_game()
    for _ in range(MAX_STILL - 1):
        first.step()
        second.step()


def sleepy(choose):
    """A script that goes into a conversation and then does nothing."""

    def choice(tick, out):
        return None if out["frame"]["player"]["talk"] else choose(tick, out)

    return choice


def test_a_driver_whose_script_does_not_act_in_a_conversation_stops_with_an_error(monkeypatch):
    bridge_run = bridge_driver.Driver(restores=False)
    monkeypatch.setattr(bridge_run.bot, "choose", sleepy(bridge_run.bot.choose))
    persuade_run = persuade_driver.Driver(restores=False)
    monkeypatch.setattr(persuade_run.script, "choose", sleepy(persuade_run.script.choose))
    for run in (bridge_run, persuade_run):
        with pytest.raises(RuntimeError, match="does not act in a conversation"):
            while run.game.tick < 5000:
                run.call()
        assert run.game.paused  # it stopped in the held world
    assert slice_driver.MAX_STILL == bridge_driver.MAX_STILL == persuade_driver.MAX_STILL
    assert bridge_driver.MAX_STILL < MAX_STILL  # the driver's own check comes first
