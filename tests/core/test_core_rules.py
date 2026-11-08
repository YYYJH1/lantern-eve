"""Static rules for the core: integers only, no hidden order, nothing but pure computation.

The core has to give the same ticks under CPython and Pyodide, on any machine. These tests read
every module of ``lantern_core`` as a syntax tree and fail on the constructs that would let a
float, a clock, a file or the order of a set into the world. The text helpers in ``text/`` read
what models write and are exempt.

A set is welcome for membership tests, sizes, comparisons and set algebra, whose results do not
depend on order. What is refused is walking one: a ``for`` or comprehension over a set, ``list``
or ``tuple`` of one, ``next(iter(...))``, ``pop``, unpacking, ``join``. Sort first. The check
follows a name that is assigned a set within the same function or module, and a parameter
annotated as a set. The run-time counterpart is the test that repeats a run under different
``PYTHONHASHSEED`` values.
"""

import ast
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / "core" / "lantern_core"
EXEMPT = ("text",)
# Modules whose use cannot let time, the machine or a float into the state.
ALLOWED_IMPORTS = (
    "__future__",
    "collections",
    "dataclasses",
    "enum",
    "functools",
    "hashlib",
    "heapq",
    "itertools",
    "json",
    "lantern_core",
    "re",
    "typing",
)
FORBIDDEN_CALLS = (
    "float",
    "complex",
    "hash",
    "id",
    "open",
    "input",
    "print",
    "eval",
    "exec",
    "compile",
    "__import__",
)
SET_CONSTRUCTORS = ("set", "frozenset")
SET_ANNOTATIONS = ("set", "frozenset", "Set", "AbstractSet", "MutableSet")
SET_ALGEBRA = ("union", "intersection", "difference", "symmetric_difference", "copy")
# Calls that walk their argument in its own order.
WALKING_CALLS = ("list", "tuple", "iter", "next", "enumerate", "zip", "map", "filter")
SCOPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)


def is_set(node, names):
    """Whether ``node`` is, as far as a syntax tree shows, a set."""
    if isinstance(node, ast.Set | ast.SetComp):
        return True
    if isinstance(node, ast.Name):
        return node.id in names
    if isinstance(node, ast.IfExp):
        return is_set(node.body, names) or is_set(node.orelse, names)
    if isinstance(node, ast.BinOp) and isinstance(
        node.op, ast.BitOr | ast.BitAnd | ast.Sub | ast.BitXor
    ):
        return is_set(node.left, names) or is_set(node.right, names)
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Name):
            return func.id in SET_CONSTRUCTORS
        if isinstance(func, ast.Attribute) and func.attr in SET_ALGEBRA:
            return is_set(func.value, names)
    return False


def scope_nodes(scope):
    """The nodes of one scope, not those inside the functions and classes nested in it."""
    stack = list(reversed(scope.body))
    while stack:
        node = stack.pop()
        yield node
        if not isinstance(node, SCOPES):
            stack.extend(reversed(list(ast.iter_child_nodes(node))))


def set_names(scope, nodes):
    """Names that hold a set in this scope: assigned one, or a parameter annotated as one."""
    names = set()
    if isinstance(scope, ast.FunctionDef | ast.AsyncFunctionDef):
        for arg in [*scope.args.posonlyargs, *scope.args.args, *scope.args.kwonlyargs]:
            note = arg.annotation
            note = note.value if isinstance(note, ast.Subscript) else note
            if isinstance(note, ast.Name) and note.id in SET_ANNOTATIONS:
                names.add(arg.arg)
    assignments = [n for n in nodes if isinstance(n, ast.Assign | ast.AnnAssign | ast.NamedExpr)]
    for _ in range(len(assignments) + 1):
        before = len(names)
        for node in assignments:
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(node.value, ast.Tuple) and isinstance(target, ast.Tuple):
                    pairs = zip(target.elts, node.value.elts, strict=False)
                else:
                    pairs = [(target, node.value)]
                for left, right in pairs:
                    if isinstance(left, ast.Name) and right is not None and is_set(right, names):
                        names.add(left.id)
        if len(names) == before:
            break
    return names


def walks_a_set(node, names):
    """Whether ``node`` walks a set in its own order."""
    if isinstance(node, ast.For | ast.AsyncFor):
        return is_set(node.iter, names)
    if isinstance(node, ast.comprehension):
        return is_set(node.iter, names)
    if isinstance(node, ast.Starred):
        return is_set(node.value, names)
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Name) and func.id in WALKING_CALLS:
            return any(is_set(arg, names) for arg in node.args)
        if isinstance(func, ast.Attribute):
            if func.attr == "join":
                return any(is_set(arg, names) for arg in node.args)
            if func.attr == "pop" and not node.args:
                return is_set(func.value, names)
    return False


def violations(source):
    """What in ``source`` breaks the rules, as ``line: reason`` strings."""
    tree = ast.parse(source)
    found = []
    for node in ast.walk(tree):
        line = getattr(node, "lineno", 0)
        if isinstance(node, ast.BinOp | ast.AugAssign) and isinstance(node.op, ast.Div):
            found.append(f"{line}: true division (use //)")
        elif isinstance(node, ast.Constant) and isinstance(node.value, float | complex):
            found.append(f"{line}: float literal {node.value!r}")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in FORBIDDEN_CALLS:
                found.append(f"{line}: call to {node.func.id}()")
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] not in ALLOWED_IMPORTS:
                    found.append(f"{line}: import of {alias.name}")
        elif isinstance(node, ast.ImportFrom) and (
            node.level or (node.module or "").split(".")[0] not in ALLOWED_IMPORTS
        ):
            found.append(f"{line}: import from {node.module}")
    scopes = [
        tree,
        *(n for n in ast.walk(tree) if isinstance(n, SCOPES) and not isinstance(n, ast.Lambda)),
    ]
    for scope in scopes:
        nodes = list(scope_nodes(scope))
        names = set_names(scope, nodes)
        for node in nodes:
            for inner in ast.walk(node) if not isinstance(node, SCOPES) else ():
                if walks_a_set(inner, names):
                    found.append(f"{getattr(inner, 'lineno', 0)}: walks a set in its own order")
    return sorted(set(found))


def core_modules():
    return sorted(
        path
        for path in CORE.rglob("*.py")
        if path.relative_to(CORE).parts[0] not in EXEMPT and "__pycache__" not in path.parts
    )


@pytest.mark.parametrize("path", core_modules(), ids=lambda p: str(p.relative_to(CORE)))
def test_core_module_follows_the_rules(path):
    assert violations(path.read_text(encoding="utf-8")) == []


def test_the_rules_look_at_every_module():
    names = {str(p.relative_to(CORE)) for p in core_modules()}
    assert {"api.py", "canon.py", "kernel.py", "rng.py", "replay.py", "world/m0.py"} <= names
    bridge = {"__init__", "bt", "clock", "data", "goap", "npcs", "order", "people", "sim"}
    bridge |= {"tasks", "town", "weather", "world"}
    assert {f"world/bridge/{name}.py" for name in bridge} <= names
    assert not any(name.startswith("text/") for name in names)


@pytest.mark.parametrize(
    "source",
    [
        "x = 1 / 2",
        "x /= 2",
        "x = 1.0",
        "x = 1e3",
        "x = 2j",
        "x = float(3)",
        "x = hash('a')",
        "x = id(a)",
        "f = open('x')",
        "print(1)",
        "import random",
        "import time",
        "import os",
        "import math",
        "from datetime import datetime",
        "from . import canon",
        "exec('x')",
        "for i in {1, 2}:\n    pass",
        "for i in set(a):\n    pass",
        "x = [i for i in {1, 2}]",
        "x = {i: 1 for i in frozenset(a)}",
        "x = list({1, 2})",
        "x = tuple(set(a))",
        "x = next(iter(set(a)))",
        "x = ','.join({'a', 'b'})",
        "x = [*{1, 2}]",
        "s = set(a)\nfor i in s:\n    pass",
        "s = set(a)\nt = s\nfor i in t:\n    pass",
        "a, b = set(x), set(y)\nfor i in a | b:\n    pass",
        "def f(s):\n    t = {1}\n    return list(t.union(s))",
        "def f(s: set[str]):\n    for i in s:\n        pass",
        "def f(s: frozenset):\n    return tuple(s)",
        "def f():\n    s = {1, 2}\n    return s.pop()",
        "s = {1}\nclass C:\n    def f(self):\n        for i in {2}:\n            pass",
    ],
)
def test_the_checker_catches(source):
    assert violations(source), source


@pytest.mark.parametrize(
    "source",
    [
        "x = 1 // 2",
        "x //= 2",
        "x = 2 ** 53",
        "x = 7 % 3",
        "import json",
        "from collections.abc import Sequence",
        "from lantern_core import canon",
        "x = isinstance(y, float)",
        "def f(parse_float): return parse_float",
        "if k in {'a', 'b'}:\n    pass",
        "if k not in {'a'}:\n    pass",
        "s = {1, 2}",
        "n = len(set(names)) != len(names)",
        "missing = sorted(required - set(value))",
        "s = set(a)\nfor i in sorted(s):\n    pass",
        "s = set(a)\nok = s == t and k in s and len(s) > 2",
        "s = set(a)\nt = s | {3}\nx = sorted(t)",
        "x = [i for i in sorted({1, 2})]",
        "for i in range(len({1, 2})):\n    pass",
        "def f(s):\n    for i in s:\n        pass",
        "def f(items):\n    s = list(items)\n    for i in s:\n        pass",
        "def f():\n    s = {1}\n    def g(s):\n        for i in s:\n            pass",
    ],
)
def test_the_checker_lets_these_through(source):
    assert violations(source) == [], source


def test_the_core_package_has_no_dependencies():
    meta = tomllib.loads((ROOT / "core" / "pyproject.toml").read_text(encoding="utf-8"))
    assert meta["project"]["dependencies"] == []
