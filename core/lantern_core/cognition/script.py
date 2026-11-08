"""A compiled script as the core reads it: its cast, props, groups, rules, lies, truth and chains.

``content/compiled/<script>.json`` holds one script. Besides the props themselves it tells which
props are true in each variant of the truth (``true_props``, and ``true_negations`` for the
denials that hold because nothing happened), the exclusive groups, the speculation rules, the
lies each character may tell and the rumour chains the script plants. Events are not here:
``is_true`` still judges a prop against the events a running game made. The variants are how a
scripted prop is judged before a game has made any.

The sections the core does not read yet (evidence, goals, endings and the like) are accepted
and left alone. A section the compiler adds that is not listed in ``UNREAD`` is refused, so a
change of the contract does not pass unnoticed.

``ScriptBook.problems`` runs every check the core has over the whole script at once, and
returns what is wrong in plain sentences. A script that loads and has no problems is one the
four paths can be run over.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lantern_core import canon
from lantern_core.cognition._fields import (
    ShapeError,
    as_dict,
    as_int,
    as_list,
    as_opt_str,
    as_str,
    as_str_tuple,
)
from lantern_core.cognition.props import (
    ExclusiveGroups,
    PropBook,
    Registry,
    Tables,
    mutation_problem,
)
from lantern_core.cognition.rules import LieEnvelope, LieTemplate, SpecRule

UNREAD = (
    "summary",
    "shared",
    "observations",
    "openings",
    "evidence",
    "evidence_sets",
    "flags",
    "metrics",
    "goals",
    "endings",
    "hard_conditions",
    "tasks",
    "wants",
    "act_minutes",
    "commitments",
    "tutorial_relations",
    "hubs",
    "statement",
    "paper",
)


@dataclass(frozen=True, slots=True)
class Variant:
    """One way the story may have gone, and which props are true in it.

    ``true_props`` are the positive props that happened. ``true_negations`` are the denials that
    hold, which follow from the closed world and are never events.
    """

    id: str
    label: str
    true_props: tuple[str, ...]
    true_negations: tuple[str, ...]

    def to_canon(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "true_props": list(self.true_props),
            "true_negations": list(self.true_negations),
        }

    @classmethod
    def from_canon(cls, value: Any, where: str = "variant") -> Variant:
        d = as_dict(value, where, ("id", "label", "true_props", "true_negations"))
        return cls(
            as_str(d["id"], f"{where}.id"),
            as_str(d["label"], f"{where}.label"),
            as_str_tuple(d["true_props"], f"{where}.true_props"),
            as_str_tuple(d["true_negations"], f"{where}.true_negations"),
        )


@dataclass(frozen=True, slots=True)
class ChainHop:
    """One hop of a rumour chain. The root has no speaker, listener or rule.

    Every later hop says who told the prop and who heard it, and ``via`` names the speculation
    rule behind a step that changes the predicate.
    """

    prop: str
    speaker: str | None
    listener: str | None
    via: str | None

    def to_canon(self) -> dict[str, Any]:
        return {
            "prop": self.prop,
            "speaker": self.speaker,
            "listener": self.listener,
            "via": self.via,
        }

    @classmethod
    def from_canon(cls, value: Any, where: str = "hop") -> ChainHop:
        d = as_dict(value, where, ("prop", "speaker", "listener", "via"))
        return cls(
            as_str(d["prop"], f"{where}.prop"),
            as_opt_str(d["speaker"], f"{where}.speaker"),
            as_opt_str(d["listener"], f"{where}.listener"),
            as_opt_str(d["via"], f"{where}.via"),
        )


@dataclass(frozen=True, slots=True)
class Chain:
    """A rumour the script plants: a root prop and the retellings that change it, in order."""

    id: str
    label: str
    hops: tuple[ChainHop, ...]

    def __post_init__(self) -> None:
        as_str(self.id, "chain.id")
        if len(self.hops) < 2:
            raise ShapeError(f"chain {self.id}: needs a root and one retelling at least")

    def to_canon(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label, "hops": [h.to_canon() for h in self.hops]}

    @classmethod
    def from_canon(cls, value: Any, where: str = "chain") -> Chain:
        d = as_dict(value, where, ("id", "label", "hops"))
        return cls(
            as_str(d["id"], f"{where}.id"),
            as_str(d["label"], f"{where}.label"),
            tuple(
                ChainHop.from_canon(h, f"{where}.hops[{i}]")
                for i, h in enumerate(as_list(d["hops"], f"{where}.hops"))
            ),
        )


def _unique(ids: list[str], what: str) -> None:
    if len(set(ids)) != len(ids):
        raise ShapeError(f"duplicate {what} ids in {sorted(ids)}")


class ScriptBook:
    """Everything one compiled script says that the core uses."""

    __slots__ = (
        "chains",
        "days",
        "groups",
        "id",
        "label",
        "lies",
        "props",
        "registry",
        "rules",
        "templates",
        "truth_fixed_at",
        "variants",
    )

    def __init__(
        self,
        id: str,
        label: str,
        days: int,
        truth_fixed_at: int,
        registry: Registry,
        props: PropBook,
        groups: ExclusiveGroups,
        variants: tuple[Variant, ...],
        chains: tuple[Chain, ...],
        lies: tuple[LieEnvelope, ...],
        rules: tuple[SpecRule, ...],
    ) -> None:
        self.id = as_str(id, "script.id")
        self.label = as_str(label, f"{id}.label")
        self.days = as_int(days, f"{id}.days", 1)
        self.truth_fixed_at = as_int(truth_fixed_at, f"{id}.truth_fixed_at", 0)
        self.registry = registry
        self.props = props
        self.groups = groups
        if not variants:
            raise ShapeError(f"{id}: needs at least one variant")
        _unique([v.id for v in variants], "variant")
        _unique([c.id for c in chains], "chain")
        _unique([e.holder for e in lies], "lie holder")
        _unique([t.id for e in lies for t in e.templates], "lie template")
        _unique([r.id for r in rules], "rule")
        self.variants = variants
        self.chains = chains
        self.lies = lies
        self.rules: dict[str, SpecRule] = {r.id: r for r in rules}
        self.templates: dict[str, LieTemplate] = {t.id: t for e in lies for t in e.templates}

    # -- truth -----------------------------------------------------------------------------

    def variant(self, variant_id: str) -> Variant:
        for v in self.variants:
            if v.id == variant_id:
                return v
        raise KeyError(variant_id)

    def true_props(self, variant_id: str) -> tuple[str, ...]:
        """The positive props that are true in the variant, in id order."""
        return self.variant(variant_id).true_props

    def true_negations(self, variant_id: str) -> tuple[str, ...]:
        """The denials that are true in the variant, in id order."""
        return self.variant(variant_id).true_negations

    def holds(self, variant_id: str, prop_id: str) -> bool:
        """Whether the prop, a statement or a denial, is true in the variant. A prop that is in
        no variant, such as a rumour nobody started from the truth, holds in none."""
        v = self.variant(variant_id)
        return prop_id in v.true_props or prop_id in v.true_negations

    # -- checks ----------------------------------------------------------------------------

    def problems(self, tables: Tables) -> list[str]:
        """Every way the script breaks the tables or itself, in a fixed order."""
        return [f"{self.id}: {m}" for m in self._parts(tables)]

    def _parts(self, tables: Tables) -> list[str]:
        out = self.props.check(tables, self.registry)
        out += self.groups.check(self.props)
        for rule in self.rules.values():
            out += rule.problems(tables, self.registry)
        for envelope in self.lies:
            out += envelope.problems(self.props, tables, self.registry)
        out += self._variant_problems()
        out += self._lie_truth_problems()
        out += self._licence_problems(tables)
        out += self._chain_problems(tables)
        return out

    def _variant_problems(self) -> list[str]:
        out: list[str] = []
        for v in self.variants:
            for pid, negated, listed in (
                *((p, False, "true_props") for p in v.true_props),
                *((p, True, "true_negations") for p in v.true_negations),
            ):
                prop = self.props.get(pid)
                if prop is None:
                    out.append(f"variant {v.id}: {listed} names unknown prop {pid!r}")
                elif prop.neg != negated:
                    kind = "a negation" if prop.neg else "not a negation"
                    out.append(f"variant {v.id}: {pid} is {kind}, so not for {listed}")
            for g in self.groups.groups:
                together = [pid for pid in g.props if self.holds(v.id, pid)]
                if len(together) > 1:
                    out.append(f"group {g.id}: variant {v.id} makes {together} true together")
        return out

    def _lie_truth_problems(self) -> list[str]:
        out: list[str] = []
        for t in self.templates.values():
            if t.prop is None or t.prop not in self.props:
                continue
            true_in = [v.id for v in self.variants if self.holds(v.id, t.prop)]
            if t.source_only and not true_in:
                out.append(f"lie template {t.id}: source_only, but {t.prop!r} is false everywhere")
            if not t.source_only and len(true_in) == len(self.variants):
                out.append(f"lie template {t.id}: {t.prop!r} is true everywhere, so no lie")
        return out

    def _licence_problems(self, tables: Tables) -> list[str]:
        """Every prop that ``assimilate`` made by changing the predicate must have a rule."""
        out: list[str] = []
        for pid in self.props:
            prop = self.props[pid]
            parent = None if prop.parent is None else self.props.get(prop.parent)
            if prop.op != "assimilate" or parent is None or parent.pred == prop.pred:
                continue
            reasons = [
                mutation_problem(
                    parent, prop, "assimilate", tables, self.registry, rule, book=self.props
                )
                for rule in self.rules.values()
            ]
            if all(reason is not None for reason in reasons):
                out.append(f"{pid}: no rule of the script turns {parent.id} into it")
        return out

    def _chain_problems(self, tables: Tables) -> list[str]:
        out: list[str] = []
        for chain in self.chains:
            previous: str | None = None
            for i, hop in enumerate(chain.hops):
                where = f"chain {chain.id} hop {i + 1}"
                prop = self.props.get(hop.prop)
                if prop is None:
                    out.append(f"{where}: unknown prop {hop.prop!r}")
                    previous = None
                    continue
                if i == 0:
                    if hop.speaker or hop.listener or hop.via:
                        out.append(f"{where}: the root has no speaker, listener or rule")
                else:
                    out += self._hop_problems(where, hop, prop.parent, previous, tables)
                previous = hop.prop
        return out

    def _hop_problems(
        self, where: str, hop: ChainHop, parent: str | None, previous: str | None, tables: Tables
    ) -> list[str]:
        out: list[str] = []
        for role, who in (("speaker", hop.speaker), ("listener", hop.listener)):
            person = None if who is None else self.registry.get(who)
            if person is None or person.type != "person":
                out.append(f"{where}: the {role} {who!r} is not a person")
        if previous is not None and parent != previous:
            out.append(f"{where}: {hop.prop} has parent {parent!r}, the chain expects {previous!r}")
        if hop.via is not None:
            rule = self.rules.get(hop.via)
            prop = self.props[hop.prop]
            before = None if parent is None else self.props.get(parent)
            if rule is None:
                out.append(f"{where}: unknown rule {hop.via!r}")
            elif before is None or prop.op != "assimilate" or before.pred == prop.pred:
                out.append(f"{where}: only an assimilate that changes the predicate names a rule")
            else:
                why = mutation_problem(
                    before, prop, "assimilate", tables, self.registry, rule, book=self.props
                )
                if why is not None:
                    out.append(f"{where}: {hop.via} does not make {hop.prop}: {why}")
        return out

    # -- canonical form --------------------------------------------------------------------

    def to_canon(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "days": self.days,
            "truth_fixed_at": self.truth_fixed_at,
            "entities": self.registry.to_canon(),
            "props": self.props.to_canon(),
            "exclusive": self.groups.to_canon(),
            "variants": [v.to_canon() for v in self.variants],
            "chains": [c.to_canon() for c in self.chains],
            "lies": [e.to_canon() for e in self.lies],
            "speculation": [r.to_canon() for r in self.rules.values()],
        }

    @classmethod
    def from_canon(cls, value: Any) -> ScriptBook:
        required = (
            "id",
            "label",
            "days",
            "truth_fixed_at",
            "entities",
            "props",
            "exclusive",
            "variants",
            "chains",
            "lies",
            "speculation",
        )
        d = as_dict(value, "script", required, UNREAD)
        name = as_str(d["id"], "script.id")
        return cls(
            name,
            as_str(d["label"], f"{name}.label"),
            as_int(d["days"], f"{name}.days", 1),
            as_int(d["truth_fixed_at"], f"{name}.truth_fixed_at", 0),
            Registry.from_canon(d["entities"]),
            PropBook.from_canon(d["props"]),
            ExclusiveGroups.from_canon(d["exclusive"]),
            tuple(
                Variant.from_canon(v, f"{name}.variants[{i}]")
                for i, v in enumerate(as_list(d["variants"], f"{name}.variants"))
            ),
            tuple(
                Chain.from_canon(c, f"{name}.chains[{i}]")
                for i, c in enumerate(as_list(d["chains"], f"{name}.chains"))
            ),
            tuple(
                LieEnvelope.from_canon(e, f"{name}.lies[{i}]")
                for i, e in enumerate(as_list(d["lies"], f"{name}.lies"))
            ),
            tuple(
                SpecRule.from_canon(r, f"{name}.speculation[{i}]")
                for i, r in enumerate(as_list(d["speculation"], f"{name}.speculation"))
            ),
        )

    @classmethod
    def loads(cls, text: str | bytes) -> ScriptBook:
        """A script from the JSON text of ``content/compiled/<script>.json``."""
        return cls.from_canon(canon.loads(text))
