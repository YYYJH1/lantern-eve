"""The built web client, served from the same port as the WebSocket.

Every response carries the Content-Security-Policy that the preview server sends
(``web/src/csp.ts``, printed by ``npm run csp``). A ``<meta>`` policy covers the document only,
and a worker takes its policy from the headers of its own script, so the header goes on every
file. The policy is read from the ``<meta>`` tag that the build puts into ``index.html``, which
is the same string, so this module holds no second copy of it.
"""

from __future__ import annotations

import mimetypes
import os
from html.parser import HTMLParser
from pathlib import Path

import lantern_eve

WEB_DIR_ENV = "LANTERN_WEB_DIR"
# Types for what the build produces. The system's mime database differs from machine to machine,
# and a module script or a wasm module must not depend on it.
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".zip": "application/zip",
    ".whl": "application/octet-stream",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


class WebDirError(Exception):
    """There is no built client to serve."""


def default_web_dir() -> Path | None:
    """The first built client found: the environment, the package, the checkout's web/dist."""
    candidates = []
    if os.environ.get(WEB_DIR_ENV):
        candidates.append(Path(os.environ[WEB_DIR_ENV]))
    package = Path(lantern_eve.__file__).resolve().parent
    candidates.append(package / "web")
    candidates.append(package.parents[1] / "web" / "dist")
    for path in candidates:
        if (path / "index.html").is_file():
            return path
    return None


class _MetaPolicy(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.policy: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "meta" or self.policy is not None:
            return
        fields = {name.lower(): value for name, value in attrs}
        if (fields.get("http-equiv") or "").lower() == "content-security-policy":
            self.policy = fields.get("content")


def load_policy(web_dir: Path) -> str:
    """The Content-Security-Policy in the ``<meta>`` tag of ``index.html``."""
    parser = _MetaPolicy()
    parser.feed((web_dir / "index.html").read_text(encoding="utf-8"))
    if not parser.policy:
        raise WebDirError(f"{web_dir / 'index.html'} has no Content-Security-Policy <meta> tag")
    return parser.policy


def content_type(path: Path) -> str:
    known = TYPES.get(path.suffix.lower())
    if known is not None:
        return known
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def resolve(web_dir: Path, url_path: str) -> Path | None:
    """The file ``url_path`` names under ``web_dir``, or None. Nothing outside it is named."""
    parts = [part for part in url_path.split("/") if part not in ("", ".")]
    if any(part == ".." or "\x00" in part or "\\" in part for part in parts):
        return None
    root = web_dir.resolve()
    target = root.joinpath(*parts)
    if target.is_dir():
        target = target / "index.html"
    try:
        target = target.resolve()
    except (OSError, RuntimeError):
        return None
    if target != root and not target.is_relative_to(root):
        return None
    return target if target.is_file() else None
