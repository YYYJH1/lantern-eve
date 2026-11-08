"""How a story changes in the retelling: the four operators, made without chance.

A speaker who passes on a belief may change it by one of the operators of
``lantern_core.cognition.props``, and the habit of the speaker (the weights in the cast file)
says which. This module only builds what each operator would make of a prop; whether the speaker
may say it is for ``paths.authorize`` to judge, and which operator is used is drawn by the
caller. Every change is made the same way every time, so that the same story told the same way
is the same prop:

- ``level`` drops one thing, in this order: the predicate for the more general one the table
  names (looking for a thing at a place becomes being at the place), then the motive, then the
  span, then an optional slot. A guess that is leveled loses its hedge, and if there is nothing
  to drop that is all it does.
- ``sharpen`` makes it heavier: the next predicate up the ladder (took becomes stole), or else
  an unstated motive or an accident becomes on purpose. It applies to acts, not to states.
- ``assimilate`` bends it to what the speaker is inclined to think. A speculation rule turns a
  prop into the one it concludes (was at the bridge, and the speaker holds a grudge against whoever
  it was, becomes broke the bridge), if the speaker is suspicious enough, holds or knows the other
  premises, and has the standing the rule asks for. Failing that, the person who did it is
  swapped for their family, by a speaker of another family.
- ``fill`` gives an act that has no motive, or only on purpose, the usual motive for that act.

A prop made this way is a child of the one it came from. It keeps the id of the child the script
already has for that step (the script plants a few rumours along the way), or else gets one made
of the parent's id and the operator, with a number if the parent has had more than one child by
that operator.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING

from lantern_core.cognition.beliefs import Belief, BeliefStore
from lantern_core.cognition.props import ACCIDENT, ON_PURPOSE, Prop, Registry, mutation_problem
from lantern_core.cognition.rules import SpecRule, is_var
from lantern_core.world.bridge.lore import BLAME_PREDS

if TYPE_CHECKING:
    from lantern_core.world.bridge.lore import Lore

OP_CODES = {"level": "lv", "sharpen": "sh", "assimilate": "as", "fill": "fl"}
FILL_MOTIVES = {"damaged": "jealousy", "took": "greed", "stole": "greed", "hid": "save_face"}
DRAFT = "_"  # the id of a prop that has not been settled yet


@dataclass(frozen=True, slots=True)
class Change:
    """What one operator makes of a prop: the child, and what saying it needs."""

    op: str
    prop: Prop
    rule: str | None = None  # the speculation rule behind an assimilate that changes the predicate
    drops_hedge: bool = False  # a leveled guess is said as a plain statement


def _draft(parent: Prop, op: str, **changes: object) -> Prop:
    """A child of ``parent`` by ``op``, with what ``changes`` sets and no id yet."""
    return dataclasses.replace(parent, id=DRAFT, parent=parent.id, op=op, **changes)  # type: ignore[arg-type]


def _args(mapping: Mapping[str, str]) -> tuple[tuple[str, str], ...]:
    return tuple(sorted(mapping.items()))


# ----------------------------------------------------------------------------- operators


def _level(lore: Lore, parent: Prop, belief: Belief) -> Prop | None:
    tables, registry = lore.tables, lore.book.registry
    pred = tables.predicates[parent.pred]
    drafts: list[Prop] = []
    if not parent.neg and pred.level_to is not None:
        target = tables.predicates[pred.level_to]
        keep = {slot: entity for slot, entity in parent.args if target.slot(slot) is not None}
        if all(s.name in keep for s in target.slots if s.required):
            drafts.append(_draft(parent, "level", pred=target.id, args=_args(keep)))
    if parent.motive is not None:
        drafts.append(_draft(parent, "level", motive=None))
    if parent.span is not None:
        drafts.append(_draft(parent, "level", span=None))
    for slot in pred.slots:
        if not slot.required and parent.arg(slot.name) is not None:
            rest = {s: e for s, e in parent.args if s != slot.name}
            drafts.append(_draft(parent, "level", args=_args(rest)))
    for child in drafts:
        if mutation_problem(parent, child, "level", tables, registry) is None:
            return child
    # nothing to drop: a guess still loses its hedge
    if belief.modality == "speculate":
        return _draft(parent, "level")
    return None


def _sharpen(lore: Lore, parent: Prop) -> Prop | None:
    if parent.neg:
        return None
    tables, registry = lore.tables, lore.book.registry
    pred = tables.predicates[parent.pred]
    drafts = []
    if pred.heavier is not None:
        drafts.append(_draft(parent, "sharpen", pred=pred.heavier))
    if parent.pred in BLAME_PREDS and parent.motive in (None, ACCIDENT):
        drafts.append(_draft(parent, "sharpen", motive=ON_PURPOSE))
    for child in drafts:
        if mutation_problem(parent, child, "sharpen", tables, registry) is None:
            return child
    return None


def _fill(lore: Lore, parent: Prop) -> Prop | None:
    motive = FILL_MOTIVES.get(parent.pred)
    if parent.neg or motive is None or parent.motive not in (None, ON_PURPOSE):
        return None
    child = _draft(parent, "fill", motive=motive)
    problem = mutation_problem(parent, child, "fill", lore.tables, lore.book.registry)
    return child if problem is None else None


def _rule_envs(
    rule: SpecRule, parent: Prop, pool: list[Prop], registry: Registry
) -> Iterator[dict[str, str]]:
    """Every way the premises of ``rule`` can be met with ``parent`` as one of them."""

    def extend(rest: list[int], env: dict[str, str]) -> Iterator[dict[str, str]]:
        if not rest:
            yield env
            return
        for prop in pool:
            nxt = rule.bind(rest[0], prop, env, registry)
            if nxt is not None:
                yield from extend(rest[1:], nxt)

    for k in range(len(rule.premises)):
        env = rule.bind(k, parent, {}, registry)
        if env is not None:
            yield from extend([j for j in range(len(rule.premises)) if j != k], env)


def _assimilate_by_rule(
    lore: Lore,
    view: Mapping[str, Prop],
    parent: Prop,
    speaker: str,
    pool: list[Prop],
    suspicion: int,
    relation: Callable[[str, str, str], bool],
) -> tuple[Prop, str] | None:
    registry = lore.book.registry
    for rule in lore.book.rules.values():
        if suspicion < rule.min_suspicion or rule.conclusion.pred == parent.pred:
            continue
        for env in _rule_envs(rule, parent, pool, registry):
            if rule.relation is not None and not relation(
                rule.relation.kind, speaker, env[rule.relation.target[1:]]
            ):
                continue
            args = {
                slot: env[term[1:]] if is_var(term) else term for slot, term in rule.conclusion.args
            }
            child = _draft(
                parent, "assimilate", pred=rule.conclusion.pred, args=_args(args), neg=False
            )
            if (
                mutation_problem(
                    parent, child, "assimilate", lore.tables, registry, rule, book=view
                )
                is None
            ):
                return child, rule.id
    return None


def _assimilate_by_family(lore: Lore, parent: Prop, speaker: str) -> Prop | None:
    """The person who did it, swapped for their family, by a speaker who is not of that family."""
    if parent.neg:
        return None
    slot = lore.tables.predicates[parent.pred].slot("who")
    who = parent.arg("who")
    family = lore.family.get(who) if who is not None else None
    if slot is None or not slot.allows("family") or family is None:
        return None
    if lore.family.get(speaker) == family:
        return None
    args = {s: (family if s == "who" else e) for s, e in parent.args}
    child = _draft(parent, "assimilate", args=_args(args))
    problem = mutation_problem(parent, child, "assimilate", lore.tables, lore.book.registry)
    return child if problem is None else None


# ----------------------------------------------------------------------------- the changes


def changes(
    lore: Lore,
    view: Mapping[str, Prop],
    parent: Prop,
    belief: Belief,
    store: BeliefStore,
    *,
    suspicion: int,
    relation: Callable[[str, str, str], bool],
) -> list[Change]:
    """What each operator makes of ``parent``, for the operators that can, in the order of ``OPS``.

    ``belief`` is the speaker's belief in ``parent`` and ``store`` is everything the speaker
    holds, which the speculation rules may rest their other premises on, along with what the town
    knows.
    """
    speaker = store.holder
    out: list[Change] = []
    level = _level(lore, parent, belief)
    if level is not None:
        out.append(Change("level", level, drops_hedge=belief.modality == "speculate"))
    sharpen = _sharpen(lore, parent)
    if sharpen is not None:
        out.append(Change("sharpen", sharpen))
    held = [
        view[b.prop] for b in store if b.confidence > 0 and b.prop in view and b.prop != parent.id
    ]
    public = [view[pid] for pid in lore.public if pid in view and pid != parent.id]
    pool = sorted({p.id: p for p in (*held, *public)}.values(), key=lambda p: p.id)
    ruled = _assimilate_by_rule(lore, view, parent, speaker, pool, suspicion, relation)
    if ruled is not None:
        out.append(Change("assimilate", ruled[0], rule=ruled[1]))
    else:
        swapped = _assimilate_by_family(lore, parent, speaker)
        if swapped is not None:
            out.append(Change("assimilate", swapped))
    fill = _fill(lore, parent)
    if fill is not None:
        out.append(Change("fill", fill))
    return out


def settle(lore: Lore, made: Mapping[str, Prop], draft: Prop) -> Prop:
    """The prop for a draft: the child the script has, one already made, or a new one.

    A prop is the same step if it has the same parent, operator and content. A new one is named
    for its parent and operator, with a number after the first.
    """
    assert draft.parent is not None and draft.op is not None
    for pid in lore.authored.get((draft.parent, draft.op), ()):
        authored = lore.book.props[pid]
        if authored.same_fact(draft):
            return authored
    base = f"{draft.parent}__{OP_CODES[draft.op]}"
    taken = base
    number = 1
    while taken in made or taken in lore.book.props:
        if (prop := made.get(taken)) is not None and prop.same_fact(draft):
            return prop
        number += 1
        taken = f"{base}{number}"
    return dataclasses.replace(draft, id=taken)
