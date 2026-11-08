"""The script's guessing rules and lie templates, read in the shapes the content compiler writes.

A **speculation rule** says that when the premises hold, a conclusion may be guessed: "someone
was at the place, the broken thing is there, and the speaker has a grudge against that someone,
so guess that someone broke it". Premises and conclusion are patterns over props. A term that
starts with ``$`` is a variable, every variable has an entity type, and the rule may demand a
standing between the speaker and a person it binds (a grudge), which only the caller knows.

A **lie template** is one thing a character may say falsely: a prop and the source it claims, or
a feigned ignorance of one kind of act. Templates come in the envelope of one character, which
lists every predicate, object and source kind that character may ever claim.

Sources are written in the content as a kind. The core names a source by a person id,
``"self_seen"`` or ``"unknown"``, so a kind is mapped in one place, ``LieSource.claimed``:

- ``witnessed`` is ``"self_seen"``.
- ``heard`` from X is X.
- ``guessed`` is the liar, who claims to have worked it out.
- ``gossip`` and ``gazette`` are ``"unknown"``, the name the core gives to what a speaker read
  in the paper or heard in the street.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from typing import Any

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
from lantern_core.cognition.beliefs import SELF_SEEN, UNKNOWN
from lantern_core.cognition.props import ENTITY_TYPES, Prop, Registry, Tables

VAR_MARK = "$"
SOURCE_KINDS = ("witnessed", "heard", "guessed", "gossip", "gazette")
LIE_KINDS = ("claim", "feign_ignorance")
RELATION_HOLDERS = ("speaker",)


def is_var(term: str) -> bool:
    return term.startswith(VAR_MARK)


# ----------------------------------------------------------------------------- patterns


@dataclass(frozen=True, slots=True)
class Pattern:
    """A prop shape: a predicate and, for some of its slots, an entity or a variable.

    A prop fits if it is not a negation, has this predicate, has every slot the pattern names
    (it may have more, such as an optional place) and agrees with the entities the pattern
    spells out and with the variables bound so far. A variable that appears twice stands for
    one entity. Spans and motives are not matched.
    """

    pred: str
    args: tuple[tuple[str, str], ...]

    def __post_init__(self) -> None:
        as_str(self.pred, "pattern.pred")
        slots = []
        for pair in self.args:
            if not (isinstance(pair, tuple) and len(pair) == 2):
                raise ShapeError(f"pattern {self.pred}: expected (slot, term) pairs")
            slots.append(as_str(pair[0], f"pattern {self.pred} slot"))
            as_str(pair[1], f"pattern {self.pred}.{pair[0]}")
            if pair[1] == VAR_MARK:
                raise ShapeError(f"pattern {self.pred}.{pair[0]}: a variable needs a name")
        if slots != sorted(set(slots)):
            raise ShapeError(f"pattern {self.pred}: slots must be unique and sorted, got {slots}")

    @classmethod
    def of(cls, pred: str, args: Mapping[str, str]) -> Pattern:
        return cls(pred, tuple(sorted(args.items())))

    def variables(self) -> tuple[str, ...]:
        """The names of the variables used, without the mark, in slot order."""
        seen: list[str] = []
        for _, term in self.args:
            if is_var(term) and term[1:] not in seen:
                seen.append(term[1:])
        return tuple(seen)

    def match(
        self, prop: Prop, bindings: Mapping[str, str], bind_new: bool = True
    ) -> dict[str, str] | None:
        """The bindings after matching ``prop``, or ``None``. With ``bind_new`` false a variable
        that the bindings do not already hold cannot match."""
        if prop.neg or prop.pred != self.pred:
            return None
        have = prop.args_dict()
        out = dict(bindings)
        for slot, term in self.args:
            entity = have.get(slot)
            if entity is None:
                return None
            if not is_var(term):
                if term != entity:
                    return None
                continue
            name = term[1:]
            if name in out:
                if out[name] != entity:
                    return None
            elif bind_new:
                out[name] = entity
            else:
                return None
        return out

    def to_canon(self) -> dict[str, Any]:
        return {"pred": self.pred, "args": dict(self.args)}

    @classmethod
    def from_canon(cls, value: Any, where: str = "pattern") -> Pattern:
        d = as_dict(value, where, ("pred", "args"))
        args = d["args"]
        if not isinstance(args, dict):
            raise ShapeError(f"{where}.args: expected an object")
        for slot, term in args.items():
            as_str(slot, f"{where}.args key")
            as_str(term, f"{where}.args[{slot}]")
        return cls.of(as_str(d["pred"], f"{where}.pred"), args)


@dataclass(frozen=True, slots=True)
class Relation:
    """A standing between the speaker and a person the premises bind, such as a grudge.

    The core does not know the standing. The caller of ``authorize`` is asked, with the kind,
    the speaker and the person, and answers from the relations of the game.
    """

    kind: str
    holder: str
    target: str

    def __post_init__(self) -> None:
        as_str(self.kind, "relation.kind")
        as_choice(self.holder, RELATION_HOLDERS, "relation.holder")
        if not (is_var(self.target) and len(self.target) > 1):
            raise ShapeError(f"relation.target: expected a variable, got {self.target!r}")

    def to_canon(self) -> dict[str, Any]:
        return {"kind": self.kind, "holder": self.holder, "target": self.target}

    @classmethod
    def from_canon(cls, value: Any, where: str = "relation") -> Relation:
        d = as_dict(value, where, ("kind", "holder", "target"))
        return cls(
            as_str(d["kind"], f"{where}.kind"),
            as_str(d["holder"], f"{where}.holder"),
            as_str(d["target"], f"{where}.target"),
        )


@dataclass(frozen=True, slots=True)
class SpecRule:
    """A guessing rule written into the script: premises in, one conclusion out.

    ``vars`` gives the entity type of each variable. The premises are matched in order against
    the props the speaker names, and the conclusion against the prop spoken, with the variables
    carried across. ``relation``, if there is one, must hold between the speaker and the person
    it names. ``hedge`` are the words that mark the guess when it is said. ``min_suspicion`` is
    how suspicious a speaker must be to apply the rule.
    """

    id: str
    label: str
    vars: tuple[tuple[str, str], ...]
    premises: tuple[Pattern, ...]
    conclusion: Pattern
    relation: Relation | None
    hedge: tuple[str, ...]
    min_suspicion: int

    def __post_init__(self) -> None:
        as_str(self.id, "rule.id")
        where = f"rule {self.id}"
        as_str(self.label, f"{where}.label")
        names = [name for name, _ in self.vars]
        if names != sorted(set(names)):
            raise ShapeError(f"{where}: variables must be unique and sorted, got {names}")
        for name, type_ in self.vars:
            if not name or is_var(name):
                raise ShapeError(f"{where}: variable names are written without {VAR_MARK!r}")
            as_choice(type_, ENTITY_TYPES, f"{where}.vars[{name}]")
        if not self.premises:
            raise ShapeError(f"{where}: a rule needs at least one premise")
        used: list[str] = []
        for pattern in self.premises:
            used += pattern.variables()
        for name in self.conclusion.variables():
            if name not in used:
                raise ShapeError(f"{where}: the conclusion uses ${name}, which no premise binds")
        for name in [*used, *self.conclusion.variables()]:
            if name not in names:
                raise ShapeError(f"{where}: ${name} is not declared in vars")
        for name in names:
            if name not in used:
                raise ShapeError(f"{where}: ${name} is declared but no premise uses it")
        if self.relation is not None:
            target = self.relation.target[1:]
            if dict(self.vars).get(target) != "person":
                raise ShapeError(f"{where}: the relation target ${target} must be a person")
        if not self.hedge or any(not isinstance(h, str) or not h.strip() for h in self.hedge):
            raise ShapeError(f"{where}: hedge needs one or more non-empty words")
        as_int(self.min_suspicion, f"{where}.min_suspicion", 0, 100)

    def _fit(
        self,
        pattern: Pattern,
        prop: Prop,
        env: Mapping[str, str],
        registry: Registry,
        bind_new: bool = True,
    ) -> dict[str, str] | None:
        """``pattern.match``, and every variable it binds must be an entity of its type."""
        out = pattern.match(prop, env, bind_new)
        if out is None:
            return None
        types = dict(self.vars)
        for name, entity in out.items():
            if name not in env and registry.type_of(entity) != types[name]:
                return None
        return out

    def bind(
        self, index: int, prop: Prop, env: Mapping[str, str], registry: Registry
    ) -> dict[str, str] | None:
        """The bindings after ``prop`` fills premise ``index``, or ``None`` if it does not fit."""
        return self._fit(self.premises[index], prop, env, registry)

    def concludes(self, prop: Prop, env: Mapping[str, str], registry: Registry) -> bool:
        """Whether ``prop`` is what the conclusion says under ``env``, which binds all of it."""
        return self._fit(self.conclusion, prop, env, registry, bind_new=False) is not None

    def derivations(
        self, parent: Prop, child: Prop, pool: Iterable[Prop], registry: Registry
    ) -> Iterator[dict[str, str]]:
        """Every binding under which the rule turns ``parent`` into ``child``.

        ``parent`` fills one premise, the other premises are filled from ``pool`` in its order,
        and ``child`` is the conclusion under the bindings that come out. Premises are tried in
        order, so the first binding is the same on every run.
        """
        props = tuple(pool)
        for k, premise in enumerate(self.premises):
            env = self._fit(premise, parent, {}, registry)
            if env is not None:
                rest = [j for j in range(len(self.premises)) if j != k]
                yield from self._extend(rest, env, props, child, registry)

    def _extend(
        self,
        rest: list[int],
        env: dict[str, str],
        pool: tuple[Prop, ...],
        child: Prop,
        registry: Registry,
    ) -> Iterator[dict[str, str]]:
        if not rest:
            if self.concludes(child, env, registry):
                yield env
            return
        for prop in pool:
            nxt = self.bind(rest[0], prop, env, registry)
            if nxt is not None:
                yield from self._extend(rest[1:], nxt, pool, child, registry)

    def step_problem(
        self, parent: Prop, child: Prop, pool: Iterable[Prop], registry: Registry
    ) -> str | None:
        """Why this rule does not turn ``parent`` into ``child``, or ``None`` if it does."""
        if child.pred != self.conclusion.pred:
            return f"{self.id} concludes {self.conclusion.pred!r}, not {child.pred!r}"
        if all(p.pred != parent.pred for p in self.premises):
            return f"{self.id} has no premise about {parent.pred!r}"
        for _ in self.derivations(parent, child, pool, registry):
            return None
        return f"no binding of {self.id} turns {parent.id} into {child.id}"

    def problems(self, tables: Tables, registry: Registry) -> list[str]:
        """Every way the rule breaks the tables and the entities, in pattern order."""
        out: list[str] = []
        types = dict(self.vars)
        patterns = [(f"premise {i + 1}", p) for i, p in enumerate(self.premises)]
        patterns.append(("conclusion", self.conclusion))
        for label, pattern in patterns:
            where = f"rule {self.id} {label}"
            pred = tables.predicates.get(pattern.pred)
            if pred is None:
                out.append(f"{where}: unknown predicate {pattern.pred!r}")
                continue
            given = dict(pattern.args)
            for slot_name, term in pattern.args:
                slot = pred.slot(slot_name)
                if slot is None:
                    out.append(f"{where}: {pred.id} has no slot {slot_name!r}")
                elif is_var(term):
                    if not slot.allows(types[term[1:]]):
                        out.append(
                            f"{where}: {term} is a {types[term[1:]]}, slot {slot_name!r}"
                            f" needs a {' or '.join(slot.types)}"
                        )
                else:
                    entity = registry.get(term)
                    if entity is None:
                        out.append(f"{where}: slot {slot_name!r} names unknown entity {term!r}")
                    elif not slot.allows(entity.type):
                        out.append(
                            f"{where}: slot {slot_name!r} needs a {' or '.join(slot.types)},"
                            f" {term!r} is a {entity.type}"
                        )
            if label == "conclusion":
                for slot in pred.slots:
                    if slot.required and slot.name not in given:
                        out.append(f"{where}: missing required slot {slot.name!r} of {pred.id}")
        return out

    def to_canon(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "vars": dict(self.vars),
            "premises": [p.to_canon() for p in self.premises],
            "conclusion": self.conclusion.to_canon(),
            "relation": None if self.relation is None else self.relation.to_canon(),
            "hedge": list(self.hedge),
            "min_suspicion": self.min_suspicion,
        }

    @classmethod
    def from_canon(cls, value: Any, where: str = "rule") -> SpecRule:
        d = as_dict(
            value,
            where,
            ("id", "label", "vars", "premises", "conclusion", "relation", "hedge", "min_suspicion"),
        )
        declared = d["vars"]
        if not isinstance(declared, dict):
            raise ShapeError(f"{where}.vars: expected an object")
        relation = d["relation"]
        return cls(
            as_str(d["id"], f"{where}.id"),
            as_str(d["label"], f"{where}.label"),
            tuple(
                (as_str(name, f"{where}.vars key"), as_str(type_, f"{where}.vars[{name}]"))
                for name, type_ in sorted(declared.items())
            ),
            tuple(
                Pattern.from_canon(p, f"{where}.premises[{i}]")
                for i, p in enumerate(as_list(d["premises"], f"{where}.premises"))
            ),
            Pattern.from_canon(d["conclusion"], f"{where}.conclusion"),
            None if relation is None else Relation.from_canon(relation, f"{where}.relation"),
            as_str_tuple(d["hedge"], f"{where}.hedge"),
            as_int(d["min_suspicion"], f"{where}.min_suspicion", 0, 100),
        )


# ----------------------------------------------------------------------------- lies


@dataclass(frozen=True, slots=True)
class LieSource:
    """The source a lie claims, as the content writes it: a kind and, for ``heard``, whom from."""

    kind: str
    from_: str | None = None

    def __post_init__(self) -> None:
        as_choice(self.kind, SOURCE_KINDS, "source.kind")
        as_opt_str(self.from_, "source.from")
        if (self.kind == "heard") != (self.from_ is not None):
            raise ShapeError("source: a 'heard' source names whom it was heard from, no other does")

    def claimed(self, holder: str) -> str:
        """The claimed source the core records for ``holder`` naming this one (see the module
        docstring for the mapping)."""
        if self.kind == "witnessed":
            return SELF_SEEN
        if self.kind == "heard":
            assert self.from_ is not None
            return self.from_
        if self.kind == "guessed":
            return holder
        return UNKNOWN

    def to_canon(self) -> dict[str, Any]:
        return {"kind": self.kind, "from": self.from_}

    @classmethod
    def from_canon(cls, value: Any, where: str = "source") -> LieSource:
        d = as_dict(value, where, ("kind", "from"))
        return cls(
            as_str(d["kind"], f"{where}.kind"),
            as_opt_str(d["from"], f"{where}.from"),
        )


@dataclass(frozen=True, slots=True)
class LieTemplate:
    """One lie its ``holder`` may tell: a claim of a prop under a source, or a feigned ignorance.

    A claim names the prop and the source. ``source_only`` marks a claim whose prop is true and
    whose source is the lie. A feigned ignorance names only the kind of act the holder pretends
    not to know about.
    """

    id: str
    holder: str
    kind: str
    prop: str | None
    source: LieSource | None
    about: str | None
    source_only: bool

    def __post_init__(self) -> None:
        as_str(self.id, "template.id")
        where = f"lie template {self.id}"
        as_str(self.holder, f"{where}.holder")
        as_choice(self.kind, LIE_KINDS, f"{where}.kind")
        as_opt_str(self.prop, f"{where}.prop")
        as_opt_str(self.about, f"{where}.about")
        as_bool(self.source_only, f"{where}.source_only")
        if self.kind == "claim":
            if self.prop is None or self.source is None or self.about is not None:
                raise ShapeError(f"{where}: a claim has a prop and a source and no 'about'")
        elif self.about is None or self.prop is not None or self.source is not None:
            raise ShapeError(f"{where}: a feigned ignorance has 'about' and nothing else")
        elif self.source_only:
            raise ShapeError(f"{where}: only a claim can be source_only")

    @property
    def claimed_source(self) -> str | None:
        """The source the core records when the holder tells this lie, or ``None`` for a
        feigned ignorance."""
        return None if self.source is None else self.source.claimed(self.holder)

    def to_canon(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "prop": self.prop,
            "source": None if self.source is None else self.source.to_canon(),
            "about": self.about,
            "source_only": self.source_only,
        }

    @classmethod
    def from_canon(cls, value: Any, holder: str, where: str = "template") -> LieTemplate:
        d = as_dict(value, where, ("id", "kind", "prop", "source", "about", "source_only"))
        source = d["source"]
        return cls(
            as_str(d["id"], f"{where}.id"),
            holder,
            as_str(d["kind"], f"{where}.kind"),
            as_opt_str(d["prop"], f"{where}.prop"),
            None if source is None else LieSource.from_canon(source, f"{where}.source"),
            as_opt_str(d["about"], f"{where}.about"),
            as_bool(d["source_only"], f"{where}.source_only"),
        )


@dataclass(frozen=True, slots=True)
class LieEnvelope:
    """Everything one character may ever claim falsely, and the templates inside it.

    ``preds``, ``objects`` and ``sources`` bound the claims, ``ignorance`` the acts the holder
    may pretend not to know about, and ``motive`` is why the holder lies.
    """

    holder: str
    motive: str
    preds: tuple[str, ...]
    ignorance: tuple[str, ...]
    objects: tuple[str, ...]
    sources: tuple[str, ...]
    templates: tuple[LieTemplate, ...]

    def __post_init__(self) -> None:
        as_str(self.holder, "lies.holder")
        where = f"lies of {self.holder}"
        as_str(self.motive, f"{where}.motive")
        for kind in self.sources:
            as_choice(kind, SOURCE_KINDS, f"{where}.sources")
        if not self.templates:
            raise ShapeError(f"{where}: needs at least one template")
        ids = [t.id for t in self.templates]
        if len(set(ids)) != len(ids):
            raise ShapeError(f"{where}: duplicate template ids in {ids}")
        for t in self.templates:
            if t.holder != self.holder:
                raise ShapeError(f"{where}: {t.id} belongs to {t.holder}")
            if t.kind == "feign_ignorance" and t.about not in self.ignorance:
                raise ShapeError(f"{where}: {t.id} feigns ignorance of {t.about!r}, not allowed")
            if t.source is not None and t.source.kind not in self.sources:
                raise ShapeError(f"{where}: {t.id} claims source {t.source.kind!r}, not allowed")

    def problems(self, props: Mapping[str, Prop], tables: Tables, registry: Registry) -> list[str]:
        """Every way the envelope or a template in it breaks the tables, the entities or the
        props: a name that does not resolve, or a claim outside the envelope."""
        where = f"lies of {self.holder}"
        out: list[str] = []
        holder = registry.get(self.holder)
        if holder is None or holder.type != "person":
            out.append(f"{where}: {self.holder!r} is not a person")
        if self.motive not in tables.motives:
            out.append(f"{where}: unknown motive {self.motive!r}")
        for pred in [*self.preds, *self.ignorance]:
            if pred not in tables.predicates:
                out.append(f"{where}: unknown predicate {pred!r} in the envelope")
        for entity in self.objects:
            if entity not in registry:
                out.append(f"{where}: unknown object {entity!r}")
        for t in self.templates:
            tw = f"lie template {t.id}"
            if t.about is not None and t.about not in tables.predicates:
                out.append(f"{tw}: unknown predicate {t.about!r}")
            if t.source is not None and t.source.from_ is not None:
                teller = registry.get(t.source.from_)
                if teller is None or teller.type != "person":
                    out.append(f"{tw}: {t.source.from_!r} is not a person")
            if t.prop is None:
                continue
            prop = props.get(t.prop)
            if prop is None:
                out.append(f"{tw}: unknown prop {t.prop!r}")
                continue
            if prop.pred not in self.preds:
                out.append(f"{tw}: {self.holder} may not claim {prop.pred!r}")
            for slot, entity in prop.args:
                if entity not in self.objects:
                    out.append(f"{tw}: {self.holder} may not name {entity!r} in slot {slot!r}")
        return out

    def to_canon(self) -> dict[str, Any]:
        return {
            "holder": self.holder,
            "motive": self.motive,
            "preds": list(self.preds),
            "ignorance": list(self.ignorance),
            "objects": list(self.objects),
            "sources": list(self.sources),
            "templates": [t.to_canon() for t in self.templates],
        }

    @classmethod
    def from_canon(cls, value: Any, where: str = "lies") -> LieEnvelope:
        d = as_dict(
            value,
            where,
            ("holder", "motive", "preds", "ignorance", "objects", "sources", "templates"),
        )
        holder = as_str(d["holder"], f"{where}.holder")
        return cls(
            holder,
            as_str(d["motive"], f"{where}.motive"),
            as_str_tuple(d["preds"], f"{where}.preds"),
            as_str_tuple(d["ignorance"], f"{where}.ignorance"),
            as_str_tuple(d["objects"], f"{where}.objects"),
            as_str_tuple(d["sources"], f"{where}.sources"),
            tuple(
                LieTemplate.from_canon(t, holder, f"{where}.templates[{i}]")
                for i, t in enumerate(as_list(d["templates"], f"{where}.templates"))
            ),
        )
