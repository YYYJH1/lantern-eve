"""The closed vocabulary of the game and what can be said in it: tables, entities, props, events.

A **prop** is one typed statement: a predicate from a closed table, arguments that are entities
of the right type, an optional time span, a polarity and an optional motive from a closed motive
table. Nothing here parses language. A statement the tables cannot express cannot be a prop,
which is what lets the notebook compare statements without asking a model.

Spans are integer game minutes, 0 being 00:00 of day 1, so the night before the game is
negative. A span is closed at both ends and ``None`` means that no time was stated.

A prop made by retelling carries ``parent`` and ``op``, one of four operators:

- ``level`` drops something the parent had: a slot, the span, the motive, or the predicate
  itself for the more general one the table names (``level_to``). Dropping nothing is allowed.
  It is how a guess loses its hedge.
- ``sharpen`` makes it heavier: the predicate moves to the table's ``heavier``, or an unstated
  motive or an accident becomes ``on_purpose``.
- ``assimilate`` swaps an argument for the speaker's bias, as long as the slot takes that kind of
  entity (a person for the person's family), or turns the parent into the conclusion of a
  speculation rule, which changes the predicate.
- ``fill`` adds a concrete motive to a prop that had none, or only ``on_purpose``.

Parents and children form the tree along which a rumour is traced.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from lantern_core import canon
from lantern_core.cognition._fields import (
    ShapeError,
    as_bool,
    as_choice,
    as_dict,
    as_int,
    as_list,
    as_opt_str,
    as_str,
    as_str_tuple,
)

if TYPE_CHECKING:
    from lantern_core.cognition.rules import SpecRule

ENTITY_TYPES = ("person", "family", "thing", "place")
OPS = ("level", "sharpen", "assimilate", "fill")
AT_PRED = "at"
ACCIDENT = "accident"  # the motives that the operators know by name
ON_PURPOSE = "on_purpose"


class PropError(ValueError):
    """A prop, table or event that breaks the contract between the content and the core."""


def _items(value: Any, key: str, where: str) -> list[Any]:
    """The list in ``value``, which is either the list itself or ``{key: list}``."""
    if isinstance(value, dict) and set(value) == {key}:
        value = value[key]
    return as_list(value, where)


# ----------------------------------------------------------------------------- tables


@dataclass(frozen=True, slots=True)
class Slot:
    """One argument place of a predicate, and the types of entity that may fill it.

    Most slots take one type. The actor of an act that a family can also be blamed for takes
    two, person and family, so that retelling can swap a person for the family without changing
    the predicate. In a table a slot's ``type`` is the one type, or a list of them.
    """

    name: str
    types: tuple[str, ...]
    required: bool

    def __post_init__(self) -> None:
        as_str(self.name, "slot.name")
        if not isinstance(self.types, tuple) or not self.types:
            raise ShapeError(f"slot {self.name}: needs at least one type, got {self.types!r}")
        for t in self.types:
            as_choice(t, ENTITY_TYPES, f"slot {self.name}.type")
        if len(set(self.types)) != len(self.types):
            raise ShapeError(f"slot {self.name}: repeats a type in {list(self.types)}")
        as_bool(self.required, f"slot {self.name}.required")

    def allows(self, entity_type: str) -> bool:
        return entity_type in self.types

    def to_canon(self) -> dict[str, Any]:
        one = self.types[0] if len(self.types) == 1 else list(self.types)
        return {"name": self.name, "type": one, "required": self.required}

    @classmethod
    def from_canon(cls, value: Any, where: str = "slot") -> Slot:
        d = as_dict(value, where, ("name", "type", "required"))
        raw = d["type"]
        listed = as_str_tuple(raw, f"{where}.type") if isinstance(raw, list | tuple) else (raw,)
        return cls(
            as_str(d["name"], f"{where}.name"),
            tuple(as_choice(t, ENTITY_TYPES, f"{where}.type") for t in listed),
            as_bool(d["required"], f"{where}.required"),
        )


@dataclass(frozen=True, slots=True)
class Predicate:
    """An action or state from the closed table, with its ordered argument places.

    ``level_to`` is the more general predicate that flattening may move to (looking for a thing
    at a place, flattened, is being at that place). ``heavier`` is the next rung up in
    severity, with the same slot names (taking becomes stealing). Both are optional.
    """

    id: str
    label: str
    slots: tuple[Slot, ...]
    level_to: str | None = None
    heavier: str | None = None

    def slot(self, name: str) -> Slot | None:
        return next((s for s in self.slots if s.name == name), None)

    def to_canon(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "slots": [s.to_canon() for s in self.slots],
            "level_to": self.level_to,
            "heavier": self.heavier,
        }

    @classmethod
    def from_canon(cls, value: Any, where: str = "predicate") -> Predicate:
        d = as_dict(value, where, ("id", "label", "slots"), ("level_to", "heavier"))
        slots = tuple(
            Slot.from_canon(s, f"{where}.slots[{i}]")
            for i, s in enumerate(as_list(d["slots"], f"{where}.slots"))
        )
        names = [s.name for s in slots]
        if len(set(names)) != len(names):
            raise ShapeError(f"{where}: duplicate slot names in {names}")
        return cls(
            as_str(d["id"], f"{where}.id"),
            as_str(d["label"], f"{where}.label"),
            slots,
            as_opt_str(d.get("level_to"), f"{where}.level_to"),
            as_opt_str(d.get("heavier"), f"{where}.heavier"),
        )


@dataclass(frozen=True, slots=True)
class Motive:
    """A reason from the closed motive table: revenge, jealousy, accident, and the like."""

    id: str
    label: str

    def to_canon(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label}

    @classmethod
    def from_canon(cls, value: Any, where: str = "motive") -> Motive:
        d = as_dict(value, where, ("id", "label"))
        return cls(as_str(d["id"], f"{where}.id"), as_str(d["label"], f"{where}.label"))


class Tables:
    """The predicate table and the motive table of one script, in declaration order.

    A ``level_to`` or ``heavier`` must name another predicate of the table. A ``heavier`` keeps
    the slot names, so that heavier news still fits the arguments it was told with. A
    ``level_to`` may require only slots that the predicate it flattens has, or a flattened
    statement could never be complete.
    """

    __slots__ = ("motives", "predicates")

    def __init__(self, predicates: Iterable[Predicate], motives: Iterable[Motive]) -> None:
        self.predicates: dict[str, Predicate] = {}
        for p in predicates:
            if p.id in self.predicates:
                raise ShapeError(f"duplicate predicate id {p.id!r}")
            self.predicates[p.id] = p
        self.motives: dict[str, Motive] = {}
        for m in motives:
            if m.id in self.motives:
                raise ShapeError(f"duplicate motive id {m.id!r}")
            self.motives[m.id] = m
        for p in self.predicates.values():
            self._check_ladder(p)

    def _check_ladder(self, p: Predicate) -> None:
        names = sorted(s.name for s in p.slots)
        for hint, target_id in (("level_to", p.level_to), ("heavier", p.heavier)):
            if target_id is None:
                continue
            target = self.predicates.get(target_id)
            if target is None or target_id == p.id:
                raise ShapeError(f"{p.id}.{hint}: {target_id!r} is not another predicate")
            if hint == "heavier" and sorted(s.name for s in target.slots) != names:
                raise ShapeError(f"{p.id}.heavier: {target_id!r} must have the same slot names")
            if hint == "level_to":
                lacking = [s.name for s in target.slots if s.required and s.name not in names]
                if lacking:
                    raise ShapeError(f"{p.id}.level_to: {target_id!r} also needs {lacking}")

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, Tables)
            and self.predicates == other.predicates
            and self.motives == other.motives
        )

    def to_canon(self) -> dict[str, Any]:
        return {
            "predicates": [p.to_canon() for p in self.predicates.values()],
            "motives": [m.to_canon() for m in self.motives.values()],
        }

    @classmethod
    def from_canon(cls, value: Any) -> Tables:
        d = as_dict(value, "tables", ("predicates", "motives"))
        return cls(
            [
                Predicate.from_canon(p, f"tables.predicates[{i}]")
                for i, p in enumerate(as_list(d["predicates"], "tables.predicates"))
            ],
            [
                Motive.from_canon(m, f"tables.motives[{i}]")
                for i, m in enumerate(as_list(d["motives"], "tables.motives"))
            ],
        )

    @classmethod
    def loads(cls, text: str | bytes) -> Tables:
        """Tables from the JSON text of ``content/compiled/tables.json``."""
        return cls.from_canon(canon.loads(text))


# ----------------------------------------------------------------------------- entities


@dataclass(frozen=True, slots=True)
class Entity:
    """A person, a family, a thing or a place. Only people may belong to a family.

    ``label`` is the Chinese name and ``label_en`` the optional English one. The core never
    reads either: the labels travel with the entity so that a client can show the right one.
    """

    id: str
    type: str
    label: str
    family: str | None = None
    label_en: str | None = None

    def to_canon(self) -> dict[str, Any]:
        d: dict[str, Any] = {"id": self.id, "type": self.type, "label": self.label}
        if self.label_en is not None:
            d["label_en"] = self.label_en
        if self.type == "person":
            d["family"] = self.family
        return d

    @classmethod
    def from_canon(cls, value: Any, where: str = "entity") -> Entity:
        d = as_dict(value, where, ("id", "type", "label"), ("family", "label_en"))
        type_ = as_choice(d["type"], ENTITY_TYPES, f"{where}.type")
        if type_ != "person" and d.get("family") is not None:
            raise ShapeError(f"{where}: only a person has a family")
        return cls(
            as_str(d["id"], f"{where}.id"),
            type_,
            as_str(d["label"], f"{where}.label"),
            as_opt_str(d.get("family"), f"{where}.family"),
            as_opt_str(d.get("label_en"), f"{where}.label_en"),
        )


class Registry:
    """Every entity of a script by id, in declaration order."""

    __slots__ = ("_entities",)

    def __init__(self, entities: Iterable[Entity]) -> None:
        self._entities: dict[str, Entity] = {}
        for e in entities:
            if e.id in self._entities:
                raise ShapeError(f"duplicate entity id {e.id!r}")
            self._entities[e.id] = e
        for e in self._entities.values():
            if e.family is not None:
                fam = self._entities.get(e.family)
                if fam is None or fam.type != "family":
                    raise ShapeError(f"{e.id}: family {e.family!r} is not a family entity")

    def __contains__(self, entity_id: object) -> bool:
        return entity_id in self._entities

    def __len__(self) -> int:
        return len(self._entities)

    def __iter__(self) -> Iterator[Entity]:
        return iter(self._entities.values())

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Registry) and self._entities == other._entities

    def get(self, entity_id: str) -> Entity | None:
        return self._entities.get(entity_id)

    def type_of(self, entity_id: str) -> str | None:
        e = self._entities.get(entity_id)
        return None if e is None else e.type

    def of_type(self, type_: str) -> list[Entity]:
        return [e for e in self._entities.values() if e.type == type_]

    def to_canon(self) -> list[dict[str, Any]]:
        return [e.to_canon() for e in self._entities.values()]

    @classmethod
    def from_canon(cls, value: Any) -> Registry:
        return cls(
            Entity.from_canon(e, f"entities[{i}]")
            for i, e in enumerate(_items(value, "entities", "entities"))
        )

    @classmethod
    def loads(cls, text: str | bytes) -> Registry:
        """A registry from JSON text: a list of entities."""
        return cls.from_canon(canon.loads(text))


# ----------------------------------------------------------------------------- props


def _span_from_canon(value: Any, where: str) -> tuple[int, int] | None:
    if value is None:
        return None
    pair = as_list(value, where)
    if len(pair) != 2:
        raise ShapeError(f"{where}: a span has a start and an end, got {pair!r}")
    return (as_int(pair[0], f"{where}[0]"), as_int(pair[1], f"{where}[1]"))


@dataclass(frozen=True, slots=True)
class Prop:
    """One typed statement. ``args`` is a tuple of ``(slot, entity id)`` sorted by slot name."""

    id: str
    pred: str
    args: tuple[tuple[str, str], ...]
    span: tuple[int, int] | None = None
    neg: bool = False
    motive: str | None = None
    parent: str | None = None
    op: str | None = None

    def __post_init__(self) -> None:
        as_str(self.id, "prop.id")
        as_str(self.pred, f"{self.id}.pred")
        slots = []
        for pair in self.args:
            if not (isinstance(pair, tuple) and len(pair) == 2):
                raise ShapeError(f"{self.id}.args: expected (slot, entity) pairs")
            slots.append(as_str(pair[0], f"{self.id}.args slot"))
            as_str(pair[1], f"{self.id}.args[{pair[0]}]")
        if slots != sorted(set(slots)):
            raise ShapeError(f"{self.id}.args: slots must be unique and sorted, got {slots}")
        if self.span is not None:
            if not (isinstance(self.span, tuple) and len(self.span) == 2):
                raise ShapeError(f"{self.id}.span: expected a (start, end) tuple")
            start, end = as_int(self.span[0], "span start"), as_int(self.span[1], "span end")
            if start > end:
                raise ShapeError(f"{self.id}.span: start {start} is after end {end}")
        as_bool(self.neg, f"{self.id}.neg")
        as_opt_str(self.motive, f"{self.id}.motive")
        as_opt_str(self.parent, f"{self.id}.parent")
        as_opt_str(self.op, f"{self.id}.op")
        if self.parent == self.id:
            raise ShapeError(f"{self.id}: a prop cannot be its own parent")

    @classmethod
    def of(
        cls,
        id: str,
        pred: str,
        args: Mapping[str, str],
        span: tuple[int, int] | None = None,
        neg: bool = False,
        motive: str | None = None,
        parent: str | None = None,
        op: str | None = None,
    ) -> Prop:
        """A prop from a slot-to-entity mapping, which is put into sorted order."""
        pairs = tuple(sorted(args.items()))
        fixed = None if span is None else (span[0], span[1])
        return cls(id, pred, pairs, fixed, neg, motive, parent, op)

    def arg(self, slot: str) -> str | None:
        return next((e for s, e in self.args if s == slot), None)

    def args_dict(self) -> dict[str, str]:
        return dict(self.args)

    def same_fact(self, other: Prop) -> bool:
        """The same statement under another id: predicate, arguments, span, polarity and motive."""
        return (
            self.pred == other.pred
            and self.args == other.args
            and self.span == other.span
            and self.neg == other.neg
            and self.motive == other.motive
        )

    def to_canon(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "pred": self.pred,
            "args": dict(self.args),
            "span": None if self.span is None else list(self.span),
            "neg": self.neg,
            "motive": self.motive,
        }
        if self.parent is not None:
            d["parent"] = self.parent
            d["op"] = self.op
        return d

    @classmethod
    def from_canon(cls, value: Any, where: str = "prop") -> Prop:
        d = as_dict(value, where, ("id", "pred", "args", "span", "neg", "motive"), ("parent", "op"))
        args = d["args"]
        if not isinstance(args, dict):
            raise ShapeError(f"{where}.args: expected an object, got {type(args).__name__}")
        for slot, entity in args.items():
            as_str(slot, f"{where}.args key")
            as_str(entity, f"{where}.args[{slot}]")
        return cls.of(
            as_str(d["id"], f"{where}.id"),
            as_str(d["pred"], f"{where}.pred"),
            args,
            _span_from_canon(d["span"], f"{where}.span"),
            as_bool(d["neg"], f"{where}.neg"),
            as_opt_str(d["motive"], f"{where}.motive"),
            as_opt_str(d.get("parent"), f"{where}.parent"),
            as_opt_str(d.get("op"), f"{where}.op"),
        )


def _kept_or_dropped(parent: Prop, child: Prop) -> str | None:
    """Why ``child`` is not a part of what ``parent`` says, or ``None``.

    A part keeps some of the arguments with the values they had, and the span and the motive as
    they were or not at all.
    """
    have = parent.args_dict()
    for slot, entity in child.args:
        if have.get(slot) != entity:
            return f"slot {slot!r} is {entity!r}, the parent has {have.get(slot)!r}"
    if child.span not in (parent.span, None):
        return "the span may be kept or dropped, not changed"
    if child.motive not in (parent.motive, None):
        return "the motive may be kept or dropped, not changed"
    return None


def _level_problem(parent: Prop, child: Prop, tables: Tables) -> str | None:
    if child.neg != parent.neg:
        return "level keeps the polarity"
    pred = tables.predicates.get(parent.pred)
    if child.pred != parent.pred and (pred is None or pred.level_to != child.pred):
        goes_to = None if pred is None else pred.level_to
        return f"level keeps the predicate or moves to its level_to ({goes_to}), not {child.pred!r}"
    if (why := _kept_or_dropped(parent, child)) is not None:
        return f"level only drops: {why}"
    target = tables.predicates.get(child.pred)
    given = child.args_dict()
    for slot in () if target is None else target.slots:
        if slot.required and slot.name not in given:
            return f"level leaves {child.pred} without its required slot {slot.name!r}"
    for slot_name in given:
        if target is not None and target.slot(slot_name) is None:
            return f"level keeps slot {slot_name!r}, which {child.pred} does not have"
    return None


def _sharpen_problem(parent: Prop, child: Prop, tables: Tables) -> str | None:
    if (child.args, child.span, child.neg) != (parent.args, parent.span, parent.neg):
        return "sharpen keeps the arguments, the span and the polarity"
    if child.pred != parent.pred:
        pred = tables.predicates.get(parent.pred)
        if pred is None or pred.heavier != child.pred:
            heavier = None if pred is None else pred.heavier
            return f"{child.pred!r} is not the next rung above {parent.pred!r} (heavier: {heavier})"
        if child.motive != parent.motive:
            return "sharpen moves one rung or changes the motive, not both"
        return None
    if parent.motive in (None, ACCIDENT) and child.motive == ON_PURPOSE:
        return None
    return "sharpen raises the predicate a rung, or makes a missing motive or accident on_purpose"


def _assimilate_frame_problem(parent: Prop, child: Prop) -> str | None:
    if (child.span, child.neg, child.motive) != (parent.span, parent.neg, parent.motive):
        return "assimilate keeps the span, the polarity and the motive"
    return None


def _assimilate_problem(
    parent: Prop,
    child: Prop,
    tables: Tables,
    registry: Registry,
    rule: SpecRule | None,
    book: Mapping[str, Prop] | None,
    judge_rule: bool,
) -> str | None:
    if (why := _assimilate_frame_problem(parent, child)) is not None:
        return why
    if child.pred != parent.pred:
        if not judge_rule:
            return None
        if rule is None:
            return "assimilate changes the predicate, which needs a speculation rule"
        pool = [] if book is None else [book[pid] for pid in sorted(book) if not book[pid].neg]
        return rule.step_problem(parent, child, pool, registry)
    have, now = parent.args_dict(), child.args_dict()
    if sorted(have) != sorted(now):
        return "assimilate keeps the same slots"
    swapped = [slot for slot in sorted(now) if now[slot] != have[slot]]
    if not swapped:
        return "assimilate must replace an argument"
    pred = tables.predicates.get(child.pred)
    for slot_name in swapped:
        entity, slot = registry.get(now[slot_name]), None if pred is None else pred.slot(slot_name)
        if entity is None:
            return f"slot {slot_name!r}: {now[slot_name]!r} is not an entity"
        if slot is not None and not slot.allows(entity.type):
            return f"slot {slot_name!r} does not take a {entity.type}"
    return None


def _fill_problem(parent: Prop, child: Prop, tables: Tables) -> str | None:
    if (child.pred, child.args, child.span, child.neg) != (
        parent.pred,
        parent.args,
        parent.span,
        parent.neg,
    ):
        return "fill changes nothing but the motive"
    if parent.motive not in (None, ON_PURPOSE):
        return f"the parent already has the motive {parent.motive!r}"
    if child.motive is None or child.motive in (ACCIDENT, ON_PURPOSE):
        return "fill adds a concrete motive, not an accident and not on_purpose"
    if child.motive not in tables.motives:
        return f"unknown motive {child.motive!r}"
    return None


def _mutation_problem(
    parent: Prop,
    child: Prop,
    op: str,
    tables: Tables,
    registry: Registry,
    rule: SpecRule | None,
    book: Mapping[str, Prop] | None,
    judge_rule: bool,
) -> str | None:
    if op == "level":
        return _level_problem(parent, child, tables)
    if op == "sharpen":
        return _sharpen_problem(parent, child, tables)
    if op == "assimilate":
        return _assimilate_problem(parent, child, tables, registry, rule, book, judge_rule)
    if op == "fill":
        return _fill_problem(parent, child, tables)
    return f"unknown operator {op!r}"


def mutation_problem(
    parent: Prop,
    child: Prop,
    op: str,
    tables: Tables,
    registry: Registry,
    rule: SpecRule | None = None,
    *,
    book: Mapping[str, Prop] | None = None,
) -> str | None:
    """Why ``child`` is not what ``op`` makes of ``parent``, or ``None`` if it is.

    - ``level``: the polarity stays. The predicate stays, or moves to its ``level_to``. The
      child's arguments are among the parent's, by slot and value, and include every required
      slot of its predicate. The span and the motive are kept or dropped. Dropping nothing is
      allowed, which is how a guess loses its hedge.
    - ``sharpen``: arguments, span and polarity stay. Either the predicate moves to its
      ``heavier`` and the motive stays, or the predicate stays and a missing motive or an
      accident becomes ``on_purpose``.
    - ``assimilate``: span, polarity and motive stay. Either the predicate and the slot names
      stay and some argument is replaced by an entity the slot takes, or the predicate changes,
      which only a speculation ``rule`` can allow: ``parent`` fills one premise, the other
      premises are props of ``book`` and ``child`` is the conclusion under the bindings.
    - ``fill``: only the motive changes, from none or ``on_purpose`` to a concrete one.
    """
    return _mutation_problem(parent, child, op, tables, registry, rule, book, judge_rule=True)


def check_prop(
    prop: Prop, tables: Tables, registry: Registry, book: Mapping[str, Prop] | None = None
) -> list[str]:
    """Every way ``prop`` breaks the tables, the registry or the mutation rules.

    ``book`` is the set of known props, by id. Without it the parent of a mutated prop is not
    looked up, only the consistency of ``parent`` and ``op`` is checked. A prop that
    ``assimilate`` made by changing the predicate is only held to what does not depend on the
    speculation rule that allows it, since the prop does not say which rule that is. The rule is
    checked when the prop is said (``paths.authorize``) and by ``ScriptBook.problems``.
    """
    out: list[str] = []
    pred = tables.predicates.get(prop.pred)
    if pred is None:
        out.append(f"{prop.id}: unknown predicate {prop.pred!r}")
    else:
        given = prop.args_dict()
        for slot_name in given:
            if pred.slot(slot_name) is None:
                out.append(f"{prop.id}: {pred.id} has no slot {slot_name!r}")
        for slot in pred.slots:
            if slot.required and slot.name not in given:
                out.append(f"{prop.id}: missing required slot {slot.name!r} of {pred.id}")
        for slot_name, entity_id in prop.args:
            entity = registry.get(entity_id)
            slot = pred.slot(slot_name)
            if entity is None:
                out.append(f"{prop.id}: slot {slot_name!r} names unknown entity {entity_id!r}")
            elif slot is not None and not slot.allows(entity.type):
                out.append(
                    f"{prop.id}: slot {slot_name!r} needs a {' or '.join(slot.types)},"
                    f" {entity_id!r} is a {entity.type}"
                )
    if prop.motive is not None and prop.motive not in tables.motives:
        out.append(f"{prop.id}: unknown motive {prop.motive!r}")
    if (prop.parent is None) != (prop.op is None):
        out.append(f"{prop.id}: parent and op must be given together")
    elif prop.parent is not None and prop.op is not None:
        if prop.op not in OPS:
            out.append(f"{prop.id}: unknown operator {prop.op!r}")
        elif book is not None:
            parent = book.get(prop.parent)
            if parent is None:
                out.append(f"{prop.id}: unknown parent {prop.parent!r}")
            elif (
                why := _mutation_problem(
                    parent, prop, prop.op, tables, registry, None, book, judge_rule=False
                )
            ) is not None:
                out.append(f"{prop.id}: {why}")
    return out


def validate_prop(
    prop: Prop, tables: Tables, registry: Registry, book: Mapping[str, Prop] | None = None
) -> None:
    """Raise ``PropError`` listing every problem ``check_prop`` finds."""
    problems = check_prop(prop, tables, registry, book)
    if problems:
        raise PropError("; ".join(problems))


def lineage(prop_id: str, props: Mapping[str, Prop]) -> list[str]:
    """``prop_id``, then its parent, then that one's parent, up to the root or a gap in ``props``.

    A parent that points back down the chain ends the walk instead of looping.
    """
    out: list[str] = []
    cur: str | None = prop_id
    while cur is not None and cur not in out and cur in props:
        out.append(cur)
        cur = props[cur].parent
    return out


class PropBook(Mapping[str, Prop]):
    """Every prop of a game by id: those the script lists and those retelling has made.

    Iteration is in id order, so a book written out and read back is the same book.
    """

    def __init__(self, props: Iterable[Prop] = ()) -> None:
        self._props: dict[str, Prop] = {}
        for prop in props:
            self.add(prop)

    def add(self, prop: Prop) -> None:
        """Add a prop. The same prop again is fine, a different one under the same id is not."""
        old = self._props.get(prop.id)
        if old is not None and old != prop:
            raise PropError(f"{prop.id}: already in the book as a different prop")
        self._props[prop.id] = prop

    def __getitem__(self, prop_id: str) -> Prop:
        return self._props[prop_id]

    def __iter__(self) -> Iterator[str]:
        return iter(sorted(self._props))

    def __len__(self) -> int:
        return len(self._props)

    def children(self, prop_id: str) -> list[Prop]:
        """The props made directly from ``prop_id``, in id order."""
        return [p for _, p in sorted(self._props.items()) if p.parent == prop_id]

    def lineage(self, prop_id: str) -> list[str]:
        """``prop_id``, then its parent, then that one's parent, up to the root."""
        return lineage(prop_id, self._props)

    def root(self, prop_id: str) -> str:
        return self.lineage(prop_id)[-1]

    def check(self, tables: Tables, registry: Registry) -> list[str]:
        """The problems of every prop in the book, in id order."""
        return [msg for pid in self for msg in check_prop(self._props[pid], tables, registry, self)]

    def to_canon(self) -> list[dict[str, Any]]:
        return [self._props[pid].to_canon() for pid in self]

    @classmethod
    def from_canon(cls, value: Any) -> PropBook:
        return cls(
            Prop.from_canon(p, f"props[{i}]") for i, p in enumerate(_items(value, "props", "props"))
        )

    @classmethod
    def loads(cls, text: str | bytes) -> PropBook:
        """A book from JSON text: a list of props."""
        return cls.from_canon(canon.loads(text))


# ----------------------------------------------------------------------------- exclusive groups


@dataclass(frozen=True, slots=True)
class ExclusiveGroup:
    """Props of which at most one is true, such as the variants of who broke the rail."""

    id: str
    props: tuple[str, ...]

    def __post_init__(self) -> None:
        as_str(self.id, "group.id")
        if len(self.props) < 2 or len(set(self.props)) != len(self.props):
            raise ShapeError(f"group {self.id}: needs two or more different props")

    def to_canon(self) -> dict[str, Any]:
        return {"id": self.id, "props": list(self.props)}

    @classmethod
    def from_canon(cls, value: Any, where: str = "group") -> ExclusiveGroup:
        d = as_dict(value, where, ("id", "props"))
        return cls(as_str(d["id"], f"{where}.id"), as_str_tuple(d["props"], f"{where}.props"))


class ExclusiveGroups:
    """The exclusive groups of one script."""

    __slots__ = ("_by_prop", "groups")

    def __init__(self, groups: Iterable[ExclusiveGroup] = ()) -> None:
        self.groups: tuple[ExclusiveGroup, ...] = tuple(groups)
        ids = [g.id for g in self.groups]
        if len(set(ids)) != len(ids):
            raise ShapeError(f"duplicate group ids in {ids}")
        self._by_prop: dict[str, set[str]] = {}
        for g in self.groups:
            for pid in g.props:
                self._by_prop.setdefault(pid, set()).add(g.id)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, ExclusiveGroups) and self.groups == other.groups

    def together(self, a: str, b: str) -> bool:
        """Whether two different props sit in one group."""
        return a != b and bool(self._by_prop.get(a, set()) & self._by_prop.get(b, set()))

    def check(self, book: Mapping[str, Prop]) -> list[str]:
        return [
            f"group {g.id}: unknown prop {pid!r}"
            for g in self.groups
            for pid in g.props
            if pid not in book
        ]

    def to_canon(self) -> list[dict[str, Any]]:
        return [g.to_canon() for g in self.groups]

    @classmethod
    def from_canon(cls, value: Any) -> ExclusiveGroups:
        return cls(
            ExclusiveGroup.from_canon(g, f"groups[{i}]")
            for i, g in enumerate(_items(value, "groups", "groups"))
        )

    @classmethod
    def loads(cls, text: str | bytes) -> ExclusiveGroups:
        """Groups from JSON text: a list of ``{"id", "props"}``."""
        return cls.from_canon(canon.loads(text))


# ----------------------------------------------------------------------------- events and truth


@dataclass(frozen=True, slots=True)
class Event:
    """Something that really happened, and the props it makes true. Only the core knows these."""

    id: str
    tick: int
    props: tuple[Prop, ...]

    def __post_init__(self) -> None:
        as_str(self.id, "event.id")
        as_int(self.tick, f"{self.id}.tick")
        if not self.props:
            raise ShapeError(f"{self.id}: an event makes at least one prop true")
        for p in self.props:
            if p.neg:
                raise ShapeError(f"{self.id}: {p.id} is a negation, events state what happened")

    def to_canon(self) -> dict[str, Any]:
        return {"id": self.id, "tick": self.tick, "props": [p.to_canon() for p in self.props]}

    @classmethod
    def from_canon(cls, value: Any, where: str = "event") -> Event:
        d = as_dict(value, where, ("id", "tick", "props"))
        return cls(
            as_str(d["id"], f"{where}.id"),
            as_int(d["tick"], f"{where}.tick"),
            tuple(
                Prop.from_canon(p, f"{where}.props[{i}]")
                for i, p in enumerate(as_list(d["props"], f"{where}.props"))
            ),
        )


def check_event(
    event: Event, tables: Tables, registry: Registry, book: Mapping[str, Prop] | None = None
) -> list[str]:
    """The problems of every prop an event makes true, as ``check_prop`` finds them."""
    return [
        f"{event.id}: {msg}" for p in event.props for msg in check_prop(p, tables, registry, book)
    ]


def spans_overlap(a: tuple[int, int] | None, b: tuple[int, int] | None) -> bool:
    """Whether two stated spans share a minute. A span that was not stated overlaps nothing."""
    return a is not None and b is not None and a[0] <= b[1] and b[0] <= a[1]


def _holds(claim: Prop, fact: Prop) -> bool:
    """Whether the event prop ``fact`` makes the positive prop ``claim`` true."""
    if (claim.pred, claim.args) != (fact.pred, fact.args):
        return False
    if claim.motive is not None and claim.motive != fact.motive:
        return False
    if claim.span is None or fact.span is None:
        return True
    return fact.span[0] <= claim.span[0] and claim.span[1] <= fact.span[1]


def _touches(claim: Prop, fact: Prop) -> bool:
    """Whether the event prop ``fact`` happened where the negation ``claim`` denies it."""
    if (claim.pred, claim.args) != (fact.pred, fact.args):
        return False
    if claim.motive is not None and claim.motive != fact.motive:
        return False
    return claim.span is None or fact.span is None or spans_overlap(claim.span, fact.span)


def is_true(prop: Prop, events: Iterable[Event]) -> bool:
    """Whether ``prop`` is true of the world the ``events`` made.

    A positive prop is true if some event makes it true: the same predicate and arguments, a
    motive that agrees if one is stated, and a span the event's span contains. An event without
    a span holds at all times, and a prop without one is true if the thing happened at any time.
    A negation is true if no event makes its positive version happen anywhere in its span, and
    one without a span denies the thing at any time at all. This is a closed world: what no
    event says did not happen.
    """
    facts = [p for e in events for p in e.props]
    if prop.neg:
        return not any(_touches(prop, f) for f in facts)
    return any(_holds(prop, f) for f in facts)
