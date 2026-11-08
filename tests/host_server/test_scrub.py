"""Keys are replaced wherever they would be written."""

from __future__ import annotations

import json
import logging
from urllib.parse import quote

from lantern_eve.scrub import MASK, Scrubber, ScrubFilter, guard

KEY = "sk-abcdef0123456789"


def test_a_registered_key_is_replaced_in_every_form_and_short_strings_are_not_keys():
    scrubber = Scrubber()
    assert not scrubber.active and scrubber.scrub(f"Bearer {KEY}") == f"Bearer {KEY}"
    scrubber.register(KEY)
    scrubber.register("short")
    scrubber.register("")
    scrubber.register(None)
    assert scrubber.active
    assert scrubber.scrub(f"Authorization: Bearer {KEY}, again {KEY}") == (
        f"Authorization: Bearer {MASK}, again {MASK}"
    )
    assert scrubber.scrub("a short thing") == "a short thing"

    odd = 'key"with\\odd/chars+and spaces'
    scrubber.register(odd)
    assert odd not in scrubber.scrub(f"x{odd}y")
    assert json.dumps(odd)[1:-1] not in scrubber.scrub(json.dumps({"k": odd}))
    assert quote(odd, safe="") not in scrubber.scrub(f"https://h/?k={quote(odd, safe='')}")


def test_a_key_that_contains_another_is_replaced_whole():
    scrubber = Scrubber()
    scrubber.register("sk-aaaaaaaa")
    scrubber.register("sk-aaaaaaaa-longer-form")
    assert scrubber.scrub("sk-aaaaaaaa-longer-form") == MASK


def test_the_logging_filter_scrubs_the_message_the_arguments_and_the_traceback():
    scrubber = Scrubber()
    scrubber.register(KEY)
    logger = logging.getLogger("test_scrub.filter")
    logger.propagate = False
    lines: list[str] = []

    class Capture(logging.Handler):
        def emit(self, record):
            lines.append(self.format(record))

    handler = Capture()
    logger.addHandler(handler)
    logger.addFilter(ScrubFilter(scrubber))
    logger.warning("the header was %s", f"Bearer {KEY}")
    logger.warning(f"inline {KEY}")
    try:
        raise RuntimeError(f"upstream said {KEY}")
    except RuntimeError:
        logger.exception("it failed")
    assert len(lines) == 3
    assert not any(KEY in line for line in lines)
    assert f"Bearer {MASK}" in lines[0] and MASK in lines[1]
    assert "RuntimeError" in lines[2] and MASK in lines[2]


def test_guard_adds_the_shared_filter_once():
    logger = logging.getLogger("test_scrub.guard")
    assert guard(guard(logger)) is logger
    assert sum(isinstance(f, ScrubFilter) for f in logger.filters) == 1
