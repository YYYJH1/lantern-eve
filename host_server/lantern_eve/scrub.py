"""Keeping API keys out of what leaves the host: log lines, error messages and replays.

A key is read from the environment once, by the transport that uses it, and registered here.
From then on ``Scrubber.scrub`` replaces it with ``[key]`` wherever it turns up in a piece of
text, in the form it was read and in the forms a JSON string or a URL would give it. The
transport scrubs every string that comes from outside before it keeps it, a logging filter
scrubs what the host's loggers write, and the session scrubs the message of a fatal error.

Keys are never removed from the registry: a key that is no longer in use must stay out of the
logs just the same. Strings shorter than ``MIN_LENGTH`` are not registered, because replacing
them would damage unrelated text, and no real key is that short.
"""

from __future__ import annotations

import json
import logging
from urllib.parse import quote

MIN_LENGTH = 8
MASK = "[key]"


class Scrubber:
    def __init__(self) -> None:
        self._forms: tuple[str, ...] = ()

    @property
    def active(self) -> bool:
        return bool(self._forms)

    def register(self, value: str | None) -> None:
        """Remember ``value`` as a secret. Short or empty strings are ignored."""
        if not value or len(value) < MIN_LENGTH:
            return
        forms = {value, json.dumps(value)[1:-1], quote(value, safe="")}
        merged = {*self._forms, *(form for form in forms if len(form) >= MIN_LENGTH)}
        # The longest first, so that a form that contains another is replaced whole.
        self._forms = tuple(sorted(merged, key=lambda form: (-len(form), form)))

    def scrub(self, text: str) -> str:
        """``text`` with every registered secret replaced by ``[key]``."""
        for form in self._forms:
            if form in text:
                text = text.replace(form, MASK)
        return text


SCRUBBER = Scrubber()


class ScrubFilter(logging.Filter):
    """A logging filter that scrubs the message, the traceback and the stack of a record."""

    def __init__(self, scrubber: Scrubber = SCRUBBER) -> None:
        super().__init__()
        self.scrubber = scrubber

    def filter(self, record: logging.LogRecord) -> bool:
        if not self.scrubber.active:
            return True
        try:
            text = record.getMessage()
        except Exception:  # a log call with the wrong arguments is reported by logging itself
            return True
        cleaned = self.scrubber.scrub(text)
        if cleaned != text:
            record.msg, record.args = cleaned, None
        if record.exc_info and record.exc_info[0] is not None:
            trace = logging.Formatter().formatException(record.exc_info)
            cleaned = self.scrubber.scrub(trace)
            if cleaned != trace:
                record.exc_text, record.exc_info = cleaned, None
        if record.stack_info:
            record.stack_info = self.scrubber.scrub(record.stack_info)
        return True


FILTER = ScrubFilter()


def guard(logger: logging.Logger) -> logging.Logger:
    """Have ``logger`` scrub what it writes. Safe to call twice. Returns the logger."""
    if FILTER not in logger.filters:
        logger.addFilter(FILTER)
    return logger


def guard_handlers(logger: logging.Logger | None = None) -> None:
    """Scrub at the handlers of ``logger`` (the root logger by default), which also covers the
    records of libraries that log through them."""
    for handler in (logger or logging.getLogger()).handlers:
        if FILTER not in handler.filters:
            handler.addFilter(FILTER)
