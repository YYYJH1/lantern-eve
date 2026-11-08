"""Whatever errands are posted, the books balance and the world stays sane."""

from bridge_helpers import CAST, CYCLE, TOWN, bridge, state_of, world_of

from lantern_core.rng import Pcg32
from lantern_core.world.bridge import tasks

TOTAL = {"bamboo": 30, "timber": 24, "tools": 3}
ITEMS = ("bamboo", "timber", "tools")
PLACES = [p for p in TOWN.places.values() if p.door is not None]


def random_spec(rng):
    """Any request at all, valid or not: the hook has to take it or refuse it cleanly."""
    npc = rng.choice(list(CAST.index))
    place = rng.choice(PLACES).id
    kind = rng.choice(["goto", "fetch", "deliver", "carry", "work", "dance"])
    spec = {"npc": npc, "kind": kind}
    if kind in ("goto", "fetch", "deliver", "work"):
        spec["place"] = place
    if kind in ("fetch", "carry"):
        spec["item"] = rng.choice(ITEMS)
        spec["qty"] = 1 + rng.below(8)
    if kind == "carry":
        spec["src"], spec["dst"] = place, rng.choice(PLACES).id
    if kind == "work":
        spec["hours"] = 1 + rng.below(3)
    return spec


def books(state):
    held = {item: 0 for item in ITEMS}
    for npc in state["npcs"]["list"]:
        if npc["carry"] is not None:
            held[npc["carry"]] += npc["qty"]
        else:
            assert npc["qty"] == 0
    for place in sorted(state["tasks"]["stock"]):
        for item, qty in sorted(state["tasks"]["stock"][place].items()):
            assert qty >= 0, (place, item)
            held[item] += qty
    return held


def check_sane(game):
    state = state_of(game)
    assert books(state) == TOTAL
    grid = TOWN.grid
    for npc in state["npcs"]["list"]:
        assert grid.walkable(grid.index(npc["x"], npc["y"]))
    queue, done = state["tasks"]["queue"], state["tasks"]["done"]
    assert all(t["status"] in ("queued", "active") for t in queue)
    assert all(t["status"] in ("done", "failed") and t["ended"] >= t["started"] for t in done)
    ids = [t["id"] for t in [*done, *queue]]
    assert len(set(ids)) == len(ids) and max(ids, default=0) < state["tasks"]["next_id"]
    for npc_id, job in state["tasks"]["jobs"].items():
        assert any(t["id"] == job["task"] and t["npc"] == npc_id for t in queue)
    assert state["weather"]["kind"] == state["weather"]["plan"][state["weather"]["day"] - 1]


def test_random_errands_keep_the_books_balanced_and_the_world_sane():
    for seed in (1, 2, 3, 4):
        game = bridge(seed, dev_actions=1)
        rng = Pcg32(seed, 99)
        accepted = refused = 0
        for tick in range(3 * CYCLE):
            if rng.below(30) == 0:
                try:
                    tasks.assign(world_of(game), state_of(game), random_spec(rng))
                    accepted += 1
                except tasks.TaskError:
                    refused += 1
            game.step()
            if tick % 97 == 0:
                check_sane(game)
        check_sane(game)
        assert accepted > 20 and refused > 5
        state = state_of(game)
        finished = {t["status"] for t in state["tasks"]["done"]}
        assert "done" in finished
