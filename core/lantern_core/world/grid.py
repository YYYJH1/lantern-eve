"""A walkable grid with integer terrain costs, and the shortest-path fields that NPCs follow.

A path is not planned per NPC. For each destination the grid computes once, with Dijkstra's
algorithm over integer costs, how much it costs to reach that cell from every other cell, and
an NPC then steps to the neighbour that is cheapest to continue from. Many NPCs share one field,
a step costs four look-ups, and nothing about a path has to be stored in the world state.

Moves are along the four axes. The cost of a step is the cost of the cell that is entered, and a
cell of cost 0 is blocked. Ties between equally cheap neighbours go to the first one in the
order north, east, south, west, so the same field always yields the same route. The fields are a
pure function of the grid and the destination, so a cache of them is not part of any state.
"""

from __future__ import annotations

import heapq
from collections.abc import Sequence

UNREACHABLE = 1 << 30
DIRECTIONS = ((0, -1), (1, 0), (0, 1), (-1, 0))  # north, east, south, west
_MAX_CACHED_FIELDS = 96


class Grid:
    """Rows of terrain characters and the cost of entering each kind of cell.

    ``max_fields`` bounds the cache of fields. When it is full the cache is emptied, which costs
    time and changes nothing else, so a map with many goals asks for a larger one.
    """

    def __init__(
        self, rows: Sequence[str], costs: dict[str, int], max_fields: int = _MAX_CACHED_FIELDS
    ) -> None:
        if not rows or any(len(row) != len(rows[0]) for row in rows):
            raise ValueError("grid rows must be non-empty and of equal length")
        for char in "".join(rows):
            if char not in costs:
                raise ValueError(f"terrain {char!r} has no cost")
        self.rows = tuple(rows)
        self.width = len(rows[0])
        self.height = len(rows)
        self.cost = [costs[char] for row in rows for char in row]
        self._neighbours = [self._build_neighbours(i) for i in range(len(self.cost))]
        self._fields: dict[int, list[int]] = {}
        self._max_fields = max_fields

    def _build_neighbours(self, index: int) -> tuple[int, ...]:
        x, y = index % self.width, index // self.width
        found = []
        for dx, dy in DIRECTIONS:
            nx, ny = x + dx, y + dy
            if 0 <= nx < self.width and 0 <= ny < self.height:
                n = ny * self.width + nx
                if self.cost[n] > 0:
                    found.append(n)
        return tuple(found)

    def index(self, x: int, y: int) -> int:
        return y * self.width + x

    def xy(self, index: int) -> tuple[int, int]:
        return index % self.width, index // self.width

    def inside(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height

    def walkable(self, index: int) -> bool:
        return self.cost[index] > 0

    def neighbours(self, index: int) -> tuple[int, ...]:
        """The walkable cells next to ``index``, in the order north, east, south, west."""
        return self._neighbours[index]

    def field(self, goal: int) -> list[int]:
        """Cost of the cheapest route from every cell to ``goal`` (``UNREACHABLE`` if none)."""
        cached = self._fields.get(goal)
        if cached is not None:
            return cached
        if not self.walkable(goal):
            raise ValueError(f"cell {goal} is blocked")
        dist = [UNREACHABLE] * len(self.cost)
        dist[goal] = 0
        heap = [(0, goal)]
        while heap:
            d, v = heapq.heappop(heap)
            if d > dist[v]:
                continue
            # Stepping from u onto v costs cost[v], so u is cost[v] further from the goal.
            nd = d + self.cost[v]
            for u in self._neighbours[v]:
                if nd < dist[u]:
                    dist[u] = nd
                    heapq.heappush(heap, (nd, u))
        if len(self._fields) >= self._max_fields:
            self._fields.clear()
        self._fields[goal] = dist
        return dist

    def best_step(self, here: int, field: list[int]) -> int:
        """The neighbour of ``here`` that is cheapest to continue from, or ``here`` itself.

        Equally cheap neighbours resolve in the order north, east, south, west. At the goal, and
        in a cell that cannot reach it, the answer is ``here``.
        """
        if field[here] == 0 or field[here] >= UNREACHABLE:
            return here
        best = here
        best_cost = UNREACHABLE
        for n in self._neighbours[here]:
            total = field[n] + self.cost[n]
            if total < best_cost:
                best, best_cost = n, total
        return best

    def detour_steps(self, here: int, field: list[int], slack: int) -> list[int]:
        """Neighbours whose route on costs at most ``slack`` more than the cheapest, north first."""
        limit = field[here] + slack
        return [
            n
            for n in self._neighbours[here]
            if field[n] < UNREACHABLE and field[n] + self.cost[n] <= limit
        ]
