"""The static town: the grid that people walk on, the places, and the cells they stand on.

Built once per process from ``data.TOWN`` and shared by every game (see ``world.static``). The
grid's cache of shortest-path fields is a pure function of the map, so sharing it changes how
fast a game runs and nothing about what it does.

A person who goes to a place stands on one of its cells: person ``k`` of the cast takes cell
``k mod n`` of ``[door, *stands]``. Where people stand is therefore fixed by the schedule and
the cast, and no model is asked where there is room.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lantern_core.world.grid import UNREACHABLE, Grid

MAX_CACHED_FIELDS = 256


@dataclass(frozen=True, slots=True)
class Place:
    id: str
    zh: str
    en: str
    kind: str
    indoor: bool
    rect: tuple[int, int, int, int]
    cells: tuple[tuple[int, int], ...]  # the door first, then the stands; empty for water

    @property
    def door(self) -> tuple[int, int] | None:
        return self.cells[0] if self.cells else None


class Town:
    """The map of a scenario: ``grid``, ``places`` by id, and the indoor places in map order."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data
        self.width: int = data["width"]
        self.height: int = data["height"]
        costs = {entry["char"]: entry["cost"] for entry in data["legend"]}
        self.grid = Grid(data["rows"], costs, max_fields=MAX_CACHED_FIELDS)
        self.places: dict[str, Place] = {}
        for raw in data["places"]:
            cells: tuple[tuple[int, int], ...] = ()
            if raw["door"] is not None:
                cells = tuple(
                    (c[0], c[1]) for c in [raw["door"], *raw["stands"]]
                )  # door first, then stands
            self.places[raw["id"]] = Place(
                raw["id"],
                raw["zh"],
                raw["en"],
                raw["kind"],
                raw["indoor"],
                (raw["rect"][0], raw["rect"][1], raw["rect"][2], raw["rect"][3]),
                cells,
            )
        # the places people can shelter in, in the order of the map file
        self.shelters = tuple(p["id"] for p in data["places"] if p["indoor"])
        self._costs = costs
        self._opened: dict[tuple[str, ...], Grid] = {(): self.grid}

    def grid_with_open(self, opened: tuple[str, ...]) -> Grid:
        """The grid with the named barriers open, for a story that opens them.

        The grid of the town as the map file draws it has every barrier closed. This one has the
        cells of each barrier in ``opened`` turned into the character that the barrier opens
        into. It is cached by the sorted ids, like the base grid's fields, and the world does
        not use it until a package says so (``BridgeWorld.walking_grid``).
        """
        key = tuple(sorted(opened))
        if key not in self._opened:
            barriers = {b["id"]: b for b in self.data["barriers"]}
            rows = [list(row) for row in self.data["rows"]]
            for barrier_id in key:
                barrier = barriers[barrier_id]
                for x, y in barrier["cells"]:
                    rows[y][x] = barrier["open"]
            self._opened[key] = Grid(
                ["".join(row) for row in rows], self._costs, max_fields=MAX_CACHED_FIELDS
            )
        return self._opened[key]

    def stand(self, place_id: str, k: int) -> tuple[int, int]:
        """The cell where person ``k`` stands at ``place_id``."""
        cells = self.places[place_id].cells
        return cells[k % len(cells)]

    def nearest_shelter(self, x: int, y: int, grid: Grid | None = None) -> str:
        """The indoor place whose door is the cheapest to reach from ``(x, y)``.

        Ties go to the place that comes first in the map file. A place that cannot be reached is
        passed over, and the answer is the first shelter if none can be. ``grid`` is the grid
        that people walk on, the closed town if left out.
        """
        grid = self.grid if grid is None else grid
        here = grid.index(x, y)
        best, best_cost = self.shelters[0], UNREACHABLE
        for place_id in self.shelters:
            door = self.places[place_id].cells[0]
            cost = grid.field(grid.index(door[0], door[1]))[here]
            if cost < best_cost:
                best, best_cost = place_id, cost
        return best
