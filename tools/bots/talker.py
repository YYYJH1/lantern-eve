"""The talker: the late liar without its lies, so that what the lies add can be read off.

It has no promises to make, looks at the same things, asks the same people in the same order, and
tells everyone only what it has been told.
"""

from __future__ import annotations

from bots.late_liar import LateLiar


class Talker(LateLiar):
    name = "talker"

    def lying(self) -> bool:
        return False
