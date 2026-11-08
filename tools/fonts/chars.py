"""The characters the game can show.

The text of the game lives in four kinds of place: the compiled content (the lines, the script, the
cast and the town), the strings of the page (the two message tables, the components, the style
sheets and the page itself), the strings of the core and the strings of the server host. This
module reads all of them and returns the characters in them, so that a font can be cut to those.
``build.py`` cuts the fonts with it. ``tests/test_fonts.py`` asks it again and fails when a later
change to a text needs a glyph that the cut fonts do not have.

Comments and docstrings are not text that anyone sees, so they are left out. So are the prompts for
the language models, which the models read and the player does not. What is left is a little more
than what is shown (the core keeps tables of numerals that it reads and never writes) and never
less.
"""

from __future__ import annotations

import ast
import json
import re
from collections.abc import Callable, Iterator
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# Every face carries these whatever the sources say: the printable ASCII of English text and of
# numbers, and the punctuation that Chinese and English text set round a line.
BASELINE = {chr(c) for c in range(0x20, 0x7F)} | set("，。、；：？！“”‘’（）《》「」『』…—～·")

# Characters that stand for a broken text and are never drawn on purpose.
NOT_DRAWN = {"\ufffd"}

# The compiled files that are not text for the player: what the language models are asked.
NOT_FOR_THE_PLAYER = {"prompts.json"}


# ---------------------------------------------------------------- reading one kind of file


def _decode(text: str) -> str:
    """The escapes of a JavaScript string (``\\u201c``, ``\\u{1F600}``, ``\\x27``) as characters."""

    def one(match: re.Match[str]) -> str:
        digits = match.group(1) or match.group(2) or match.group(3)
        return chr(int(digits, 16))

    return re.sub(r"\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})", one, text)


class _Script:
    """Walks TypeScript or TSX source and keeps what is not a comment and not a regular expression.

    What is kept is the code (which holds the text between JSX tags), the strings and the templates.
    A ``//`` inside a string is not a comment, and a quote inside a regular expression does not
    start a string, which is why this is a small scanner and not a regular expression.
    """

    # What can stand before a regular expression. A ``<`` or a ``>`` is not among them, since
    # ``</b>`` and ``<b>/</b>`` are markup. A ``}`` is not either, since ``{a}/{b}`` is markup too.
    REGEX_AFTER = set("(,=:[!&|?{;+-*%~^") | {"return", "typeof", "case", "in", "of"}

    def __init__(self, source: str) -> None:
        self.s = source
        self.n = len(source)
        self.out: list[str] = []

    def run(self) -> str:
        self.code(0, top=True)
        return "".join(self.out)

    def code(self, i: int, top: bool = False) -> int:
        """Scans code from ``i``. Returns where it stopped: the end or a template hole's ``}``."""
        s, n, depth = self.s, self.n, 0
        tok, before, word = "", "", ""  # the last two tokens, and the word being read
        while i < n:
            c = s[i]
            if c == "/" and s.startswith("//", i):
                i = s.find("\n", i)
                i = n if i < 0 else i
                continue
            if c == "/" and s.startswith("/*", i):
                j = s.find("*/", i + 2)
                i = n if j < 0 else j + 2
                continue
            if c in "'\"" or c == "`":
                i = self.quoted(i) if c != "`" else self.template(i + 1)
                tok, before, word = '"', tok, ""
                continue
            if c == "/" and (tok == "" or tok in self.REGEX_AFTER or (before, tok) == ("=", ">")):
                end = self.regex(i + 1)
                if end > 0:
                    i = end
                    tok, before, word = '"', tok, ""
                    continue
            if c == "{":
                depth += 1
            elif c == "}":
                if depth == 0 and not top:
                    return i
                depth = max(depth - 1, 0)
            self.out.append(c)
            if c.isalnum() or c in "_$":
                if not word:  # a new word starts
                    before = tok
                word += c
                tok = word
            else:
                word = ""
                if not c.isspace():
                    before, tok = tok, c
            i += 1
        return i

    def quoted(self, i: int) -> int:
        s, n, quote = self.s, self.n, self.s[i]
        j = i + 1
        buf: list[str] = []
        while j < n and s[j] != quote and s[j] != "\n":
            if s[j] == "\\" and j + 1 < n:
                buf.append(s[j : j + 2])
                j += 2
            else:
                buf.append(s[j])
                j += 1
        self.out.append(_decode("".join(buf)))
        return j + 1

    def template(self, i: int) -> int:
        s, n = self.s, self.n
        buf: list[str] = []
        while i < n and s[i] != "`":
            if s[i] == "\\" and i + 1 < n:
                buf.append(s[i : i + 2])
                i += 2
            elif s[i] == "$" and i + 1 < n and s[i + 1] == "{":
                self.out.append(_decode("".join(buf)))
                buf = []
                i = self.code(i + 2) + 1
            else:
                buf.append(s[i])
                i += 1
        self.out.append(_decode("".join(buf)))
        return i + 1

    def regex(self, i: int) -> int:
        """Where a regular expression that starts at ``i`` ends, or -1 if it does not close."""
        s, n, in_class = self.s, self.n, False
        while i < n and s[i] != "\n":
            if s[i] == "\\":
                i += 2
                continue
            if s[i] == "[":
                in_class = True
            elif s[i] == "]":
                in_class = False
            elif s[i] == "/" and not in_class:
                i += 1
                while i < n and s[i].isalpha():  # the flags
                    i += 1
                return i
            i += 1
        return -1


def script_text(source: str) -> str:
    """The text of a TypeScript or TSX file without its comments and its regular expressions."""
    return _Script(source).run()


def style_text(source: str) -> str:
    """The text of a style sheet without its comments."""
    return re.sub(r"/\*.*?\*/", "", source, flags=re.S)


def markup_text(source: str) -> str:
    """The text of an HTML file without its comments."""
    return re.sub(r"<!--.*?-->", "", source, flags=re.S)


def _json_strings(value: object) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from _json_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _json_strings(item)


def python_strings(source: str) -> Iterator[str]:
    """The string constants of a Python file, without the docstrings and the regex patterns."""
    tree = ast.parse(source)
    skip: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            first = node.body[0] if node.body else None
            if (
                isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)
            ):
                skip.add(id(first.value))
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "re"
            and node.args
        ):
            skip.add(id(node.args[0]))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in skip:
            yield node.value


# ---------------------------------------------------------------- where the text is


def _files(pattern: str) -> list[Path]:
    return sorted(
        p
        for p in REPO.glob(pattern)
        if p.is_file() and "node_modules" not in p.parts and "__pycache__" not in p.parts
    )


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _from_json(path: Path) -> str:
    return "\n".join(_json_strings(json.loads(_read(path))))


def _from_python(path: Path) -> str:
    return "\n".join(python_strings(_read(path)))


# label -> (the files, how to read one). The label says, when a test fails, where a character is.
SOURCES: dict[str, tuple[list[str], Callable[[Path], str]]] = {
    "content": (["content/compiled/*.json"], _from_json),
    "page": (["web/src/**/*.ts", "web/src/**/*.tsx"], lambda p: script_text(_read(p))),
    "style": (["web/src/**/*.css"], lambda p: style_text(_read(p))),
    "html": (["web/index.html"], lambda p: markup_text(_read(p))),
    "core": (["core/lantern_core/**/*.py"], _from_python),
    "host": (["host_server/lantern_eve/**/*.py"], _from_python),
}


def by_source() -> dict[str, set[str]]:
    """The characters of every source, by the label of the source."""
    found: dict[str, set[str]] = {}
    for label, (patterns, read) in SOURCES.items():
        chars: set[str] = set()
        for pattern in patterns:
            for path in _files(pattern):
                if path.name not in NOT_FOR_THE_PLAYER:
                    chars |= set(read(path))
        found[label] = {c for c in chars if c.isprintable() and c not in NOT_DRAWN}
    return found


def game_chars() -> set[str]:
    """Every character the game can show: the baseline and the characters of every source."""
    chars = set(BASELINE)
    for found in by_source().values():
        chars |= found
    return chars


# ---------------------------------------------------------------- the title face

# The messages of the page that are set in the title face (a brush): the name of the game, the
# masthead of the gazette, the name of a job on the ledger, the title of a card that says that a
# job is done and what the slip says while there is no task to follow. The seals of the people are
# set in it too (see `title_text`).
TITLE_KEYS = re.compile(
    r"^(app\.title|gazette\.title|task\.job\.\w+|show\.\w+\.title|top\.task\.\w+)$"
)
_MESSAGE = re.compile(r'^\s*"([\w.]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$', re.M)


def messages(lang: str) -> dict[str, str]:
    """The message table of one language of the page: key to text, before any name is filled in."""
    text = _read(REPO / "web" / "src" / "i18n" / f"{lang}.ts")
    return {key: _decode(value.replace('\\"', '"')) for key, value in _MESSAGE.findall(text)}


def title_text() -> list[str]:
    """The words that the title face is asked to draw, one string each."""
    words: list[str] = []
    for lang in ("zh", "en"):
        words += [v for k, v in messages(lang).items() if TITLE_KEYS.match(k)]
    # The names of the tasks stand on the slips. A task may name a person, so every name goes in.
    for path in _files("content/compiled/*.json"):
        data = json.loads(_read(path))
        if isinstance(data, dict):
            for task in data.get("tasks", []):
                words += [task["text"]["zh"], task["text"]["en"]]
            for entity in data.get("entities", []):
                words += [entity["label"], entity.get("label_en", "")]
    # The seal of a surname, at the corner of the talk and on the note of a person, is set in the
    # title face: each person's token, in both languages.
    for path in _files("content/compiled/cast_*.json"):
        data = json.loads(_read(path))
        if isinstance(data, dict):
            for person in data.get("people", []):
                token = person.get("token", {})
                words += [token.get("zh", ""), token.get("en", "")]
    return words


def title_chars() -> set[str]:
    """The characters of the title face: those of the words above and the ASCII of a title."""
    chars = {c for c in BASELINE if ord(c) < 0x7F}
    for word in title_text():
        chars |= set(word)
    return {c for c in chars if c.isprintable()}
