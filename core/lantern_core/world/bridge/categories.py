"""The categories of the model requests of the bridge world, and the queue class each is meant for.

A request carries a ``category``, which says what its answer is for (``Ctx.issue``, and the
``"category"`` of an entry of ``"requests"`` in the outputs of a call). The core queues nothing. A
host does, in four classes that only decide who goes first (1 first, 4 last, and inside a class in
the order of arrival), and it finds the class of a request by its category: the server host reads
a table ``[classes]`` of its provider file, and gives a category that is not in it the class it
calls the default (3). This module is where the bridge scenario names the categories it asks
under, so that the table can be filled in from it.

The townsfolk say what their beliefs make them say (``answers``, ``lines``), and in a talk with the
manager a model is asked, under ``reply``, for the same in their own words and for how far the
manager's words move them (``replies``). The bridge world asks under no other name: the other
names have their classes ready for a host. The class is what each category is *meant* for, in the
order of the queue:

========== ===== ==============================================================================
category   class what the answer is
========== ===== ==============================================================================
reply      1     a reply the player is waiting for: what a townsperson says to the manager
prefetch   2     a reply made ahead for someone near the player, who may be spoken to next
director   3     the director's choice among the events it may stage, and the words for it
paper      3     the Town Gazette that the morning brings
reflection 4     the nightly reflection of a townsperson, and the plan for tomorrow
========== ===== ==============================================================================

What comes back under ``reply`` and ``prefetch`` is judged by ``speech`` before anyone sees it.

A host that wants the table writes ``QUEUE_CLASS`` out as it is. The m0 scenario asks under
``chatter``, which is not in this table and gets the host's default.
"""

from __future__ import annotations

REPLY = "reply"
PREFETCH = "prefetch"
DIRECTOR = "director"
PAPER = "paper"
REFLECTION = "reflection"

QUEUE_CLASS: dict[str, int] = {
    REPLY: 1,
    PREFETCH: 2,
    DIRECTOR: 3,
    PAPER: 3,
    REFLECTION: 4,
}
CATEGORIES = tuple(QUEUE_CLASS)  # in the order of the queue
