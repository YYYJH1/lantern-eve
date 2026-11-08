"""The sections of the world state, and the subsystems that run on them, in their fixed order.

This file is the one place that says what runs and in which order. The world's tick loop only
walks ``SUBSYSTEMS``, so a package that adds a subsystem adds a module and a line here, and
leaves the loop alone.

``SECTIONS`` lists every section of ``state["world"]``. A section that a subsystem owns is
named by that module's ``SECTION``. The others are reserved: they exist from the start as empty
dicts, and the subsystem that fills one makes a module that owns it. Every section is in the state
hash, the empty ones too, so a subsystem that starts to use one changes the hash by design.

``SUBSYSTEMS`` is the order in which ``init`` runs when a game is made (it may draw from the
RNG) and ``tick`` runs once for each simulated tick. The order of these four, and where the
rest go:

1. ``clock``: announces dawn and dusk, and takes the length of the tick off the time that the acts
   of the manager owe. Nothing before it.
2. ``weather``: draws the weather at dawn, after the clock has said it is dawn.
3. ``tasks``: moves the errands on from where people stood at the end of the last tick, and
   says where each person with an errand should be.
4. ``npcs``: decides for each person where to be and walks them one step.
5. ``social``: the talk between neighbours, once the walking is done.
6. ``reflection``: what the named people think over at night, and the errands they go on the next
   day, which are told in the talk of the neighbours after it has been had (it calls the same
   telling), and which move the walkers by the rule of ``bt`` in the tick after.
7. ``player``: the festival manager's moves, talks and notebook.
8. ``goals``: the call for helpers, the work on the bridge, the turnout and the ending.
9. ``crowd``: the townsfolk without names, who hear what the named ones said this tick.
10. ``speech``: the words a model writes for the townsfolk in a talk with the manager, the gate
    they pass and the counts of it. Its requests are made by the actions of the manager
    (``player``), so it only has the requests that are gone to forget.
11. ``commitments``: the promises made to the manager, once the errands have moved on and the
    goals have looked at what lies at the bridge: the people set out, the goods arrive or the
    promise is broken, and in the morning the recap of the day before.
12. ``agenda``: the tasks and the cards of the people, once the others have done their part of
    the tick. It looks again after every action of the player and every result of a model too
    (``BridgeWorld``), since those can happen in a call that simulates nothing.
13. ``budget``: the money of this game's model calls, last, after every call was made.

Every section has its subsystem. Something that has to act before the errands are moved on
goes before ``tasks``.

A subsystem module has these names, and only ``SECTION``, ``init`` and ``tick`` are required:

``SECTION``
    the name of the section it owns.
``init(world, rng)``
    the starting content of the section, a dict. It may draw from ``rng``.
``start(world, state)``
    optional: look at the first moment of the game once every section is made. ``state`` is the
    dict of sections (``state["world"]`` of the kernel's state, which does not hold it yet).
``tick(sim)``
    advance the section by one tick. ``sim`` carries the world, the kernel's ``Ctx`` (the tick,
    the RNG, ``emit``, ``signal``, ``issue``), the state and the time. See ``sim.Sim``.
``ACTIONS``
    ``{type: (validate(world, body), apply(sim, body))}``, the player actions it handles.
``CONDITIONS``
    ``{op: check(world, state, condition)}``, the ``valid_if`` conditions of model requests.
    ``state`` is the kernel's state, and the world's sections are in ``state["world"]``.
``RESULTS``
    ``{category: land(sim, request, status, text)}``, what to do with a model result.
``scene(world)``
    a dict of static content for the client, merged into ``BridgeWorld.scene()``.
``frame(world, state, out)``
    fill or extend the frame ``out`` of a call. ``state`` is the kernel's state again, and
    ``out`` already holds every key of the frame, empty or filled by the modules before it.
"""

from __future__ import annotations

from lantern_core.world.bridge import (
    agenda,
    budget,
    clock,
    commitments,
    crowd,
    goals,
    npcs,
    player,
    reflection,
    social,
    speech,
    tasks,
    weather,
)

SECTIONS = (
    "clock",
    "weather",
    "npcs",
    "tasks",
    "social",
    "reflection",
    "player",
    "goals",
    "crowd",
    "speech",
    "commitments",
    "agenda",
    "budget",
)
RESERVED: tuple[str, ...] = ()

SUBSYSTEMS = (
    clock,
    weather,
    tasks,
    npcs,
    social,
    reflection,
    player,
    goals,
    crowd,
    speech,
    commitments,
    agenda,
    budget,
)
