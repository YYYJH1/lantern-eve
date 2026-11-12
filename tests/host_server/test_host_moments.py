"""The server host while the world is held for a moment of the festival.

The page says that it shows the moments of its game, a moment holds the world as a conversation
does, and the page lets the world go on with an action. The pause reason ``show`` is the page's, for
the time a show plays on the map: it is taken and given back like the others and does not touch the
player's pause. The tests play the bridge town on a virtual clock, with the dev actions, which win
over helpers on both banks of the river.
"""

from __future__ import annotations

from host_helpers import drive_to_tick, frames, make_session

CONFIG = {"dev_actions": 1, "weather_clear": 1, "weather_light": 0, "weather_heavy": 0}


def act(session, action_id: str, type_: str, **fields) -> None:
    session.player({"action_id": action_id, "type": type_, **fields})


def watched_game():
    session, clock, out = make_session(1, scenario="bridge", config=CONFIG)
    drive_to_tick(session, clock, 20)
    act(session, "watch", "moment", op="watch")
    return session, clock, out


def test_a_moment_holds_the_world_and_the_page_lets_it_go():
    session, clock, out = watched_game()
    act(session, "j1", "dev_goal", op="join", npc="li_da")
    act(session, "j2", "dev_goal", op="join", npc="cha_laoban")
    clock.advance_ms(100)
    session.pump()
    last = frames(out)[-1]
    assert last["frame"]["moment_hold"] == ["both_banks"]
    assert [m["kind"] for m in last["frame"]["moments"]] == ["both_banks"]
    assert session.core_paused and session.reasons == []
    tick = session.next_tick
    for _ in range(30):  # the host has nothing to simulate while the world is held
        clock.advance_ms(100)
        session.pump()
    assert session.next_tick == tick and session.core_paused
    act(session, "r1", "moment", op="release", kind="both_banks")
    clock.advance_ms(100)
    session.pump()
    assert frames(out)[-1]["frame"]["moment_hold"] == []
    drive_to_tick(session, clock, tick + 20)
    assert not session.core_paused and session.next_tick >= tick + 20
    release = [
        r for r in session.recorder.records if r[2] == "player" and r[3].get("op") == "release"
    ]
    assert [r[3]["kind"] for r in release] == ["both_banks"]  # the recording has the page's act


def test_the_pause_reason_show_is_taken_and_given_back_without_touching_the_players_pause():
    session, clock, _ = watched_game()
    session.pause("user")
    session.pause("show")
    assert session.reasons == ["user", "show"] and session.core_paused
    session.resume("show")
    assert session.reasons == ["user"] and session.core_paused
    tick = session.next_tick
    clock.advance_ms(500)
    session.pump()
    assert session.next_tick == tick  # the player's pause holds
    session.resume("user")
    drive_to_tick(session, clock, tick + 5)
    assert not session.core_paused
    session.pause("show")
    clock.advance_ms(500)
    session.pump()
    assert session.core_paused
    session.resume("show")
    drive_to_tick(session, clock, session.next_tick + 5)
    assert session.reasons == [] and not session.core_paused
