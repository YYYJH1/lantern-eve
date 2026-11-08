"""The last night: who believes a falsehood about the broken rail, the endings' names, the reveal.

*What people believe.* The main conflict of the story is who or what broke the rail. A statement
about it is a non-negated ``damaged`` or ``flood_damaged`` prop whose subject is the thing the
opening shows broken. It is false when it does not tell the story that the truth of the game
tells. The story is the predicate and the arguments, which is how ``Lore.excludes`` reads a prop
made on the way, with a family standing for its members ("the Zhou family broke it" says what
"Dalang broke it" says). When it happened and why are not part of it, so a retelling that has lost
the hour or the motive of the truth is still the truth. A person *believes* a prop whose
confidence is ``BELIEVE_AT`` or more, and the share of the named townsfolk who believe a
falsehood about the conflict is the metric ``false_belief_share`` that the hidden ending reads.

*The reveal* is what the page shows after the ending, as plain data: the truth, every rumour
chain of the script that reached anyone (the claims that carried it and who holds each of its
props at the end), who believes the truth, a falsehood or nothing about the conflict, and how much
was told. A module may add to it: if ``player`` or ``social`` has a function
``ending_reveal(world_state)`` that returns a dict of plain data, the dict goes into the reveal
under the name of the module (how far the player's own words went, who said what about the manager).

Every label in the reveal is ``{"zh", "en"}`` and is said from the props of the script by the table
of lines (``cognition.lines``), so a variant or a chain that the script gains needs no text of its
own. The truth is the true statement about the conflict, as a sentence (``{"variant", "label",
"props"}``). A chain is ``{"id", "label", "texts", "planted", "true", "told", "held", "reached"}``:
its label sets the first version of the story against the last (``CHAIN_LABEL``), and ``texts`` says
every version along it, ``{prop id: {"zh", "en"}}``, which are the props of ``planted`` and so of
every row of ``told``.
"""

from __future__ import annotations

import functools
from typing import TYPE_CHECKING, Any

from lantern_core.cognition.lines import LANGUAGES, capitalise
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import goals_rules, notebook, notes, phrases, social
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.world import BridgeWorld

CONFLICT_PREDS = ("damaged", "flood_damaged")
BELIEVE_AT = 40

# The label of a chain: the story as it began and as it ended up, each said as a clause.
CHAIN_LABEL = {
    "zh": "从「{first}」传成「{last}」",
    "en": "From “{first}” to “{last}”",
}

# The names of the endings in English. The script gives the Chinese ones.
LABELS_EN = {
    "ending_full": "A perfect night",
    "ending_barely": "Just enough",
    "ending_split": "Scattered: two families light their lamps apart",
    "hidden_legend_of_lie": "The lie became a legend",
}


def label_of(ending_id: str) -> dict[str, str]:
    """The name of an ending, base or hidden, in both languages."""
    rules = goals_rules.rules()
    row = next(r for r in (*rules.rows, *rules.hidden) if r.id == ending_id)
    return {"zh": row.label, "en": LABELS_EN[ending_id]}


def wire(done: dict[str, Any], *, compact: bool = False) -> dict[str, Any]:
    """The ending as the event and the frames carry it, from what the state keeps.

    ``done`` is ``state["world"]["goals"]["ending"]`` once the last night has come. The result has
    the keys of the ``ending`` event after ``kind`` and ``tick``: ``ending`` (the id of the base
    ending), its ``label`` and the ``hidden`` endings (each ``{"id", "label"}``), every label in
    both languages, then the ``inputs``, the ``passage``, the households that ``promised``, the
    ``turnout``, the ``reveal`` and the ``epilogue``: for each person who carries the days (see
    ``roles``) the one or two sentences about how it went for them, ``[{"npc", "id", "text":
    {"zh", "en"}}]`` in the order of the cast. The compact form leaves out the ``reveal``, which is
    most of the ending, and the ``epilogue``, and keeps what a page needs to say how the night went.
    """
    from lantern_core.world.bridge import roles  # not at the top: it reads the goals

    out = {
        "ending": done["id"],
        "label": label_of(done["id"]),
        "hidden": [{"id": row_id, "label": label_of(row_id)} for row_id in done["hidden"]],
        "inputs": done["inputs"],
        "passage": done["passage"],
        "promised": done["promised"],
        "turnout": done["turnout"],
    }
    if not compact:
        out["reveal"] = done["reveal"]
        out["epilogue"] = roles.epilogue_wire(done.get("epilogue", []))
    return out


@functools.cache
def _broken_things() -> tuple[str, ...]:
    """The things the opening shows broken: what the conflict is about."""
    book = lore().book
    return tuple(
        sorted(
            {
                thing
                for pid in lore().public
                if (prop := book.props[pid]).pred == "broken" and (thing := prop.arg("what"))
            }
        )
    )


def about_the_conflict(prop: Prop) -> bool:
    """Whether ``prop`` says who or what broke the thing that the story opens with."""
    return not prop.neg and prop.pred in CONFLICT_PREDS and prop.arg("what") in _broken_things()


def true_conflict_props(variant_id: str) -> list[Prop]:
    """The props of the script about the conflict that are true in the variant."""
    lore_ = lore()
    return [
        lore_.book.props[pid]
        for pid in lore_.variants[variant_id].true_props
        if about_the_conflict(lore_.book.props[pid])
    ]


def _same_entity(one: str, other: str) -> bool:
    """Whether two entities are the same, or one is the family of the other."""
    family = lore().family
    return one == other or family.get(one) == other or family.get(other) == one


def tells_the_story(prop: Prop, true: Prop) -> bool:
    """Whether ``prop`` tells the story of ``true``: the predicate, the polarity and the entity in
    every slot that both have, a family counting for its members. The span and the motive are not
    part of the story, and a retelling that dropped a slot says what it still says."""
    if prop.pred != true.pred or prop.neg != true.neg:
        return False
    mine = prop.args_dict()
    return all(_same_entity(mine[slot], entity) for slot, entity in true.args if slot in mine)


def is_true(prop: Prop, true_ones: list[Prop]) -> bool:
    """Whether the truth of the game makes ``prop`` true: it tells the story of one of the true
    props about the conflict (``true_ones``, see ``true_conflict_props``), whatever it says of
    when or why."""
    return any(tells_the_story(prop, true) for true in true_ones)


def believers(world_state: dict[str, Any]) -> dict[str, list[str]]:
    """Who believes the truth about the conflict, who a falsehood, and who neither.

    A person who holds both is counted with those who believe a falsehood. Each list is in the
    order of the cast.
    """
    section = world_state["social"]
    found: dict[str, list[str]] = {"false": [], "true": [], "none": []}
    if "beliefs" not in section:  # a world without the talk between neighbours: no one believes
        found["none"] = list(lore().people)
        return found
    variant = section["variant"]
    true_ones = true_conflict_props(variant)
    book = social.book(section)
    stores = social.stores(section)
    for person in lore().people:
        kinds = set()
        for belief in stores[person]:
            if belief.confidence < BELIEVE_AT or belief.prop not in book:
                continue
            prop = book[belief.prop]
            if about_the_conflict(prop):
                kinds.add("true" if is_true(prop, true_ones) else "false")
        kind = "false" if "false" in kinds else "true" if "true" in kinds else "none"
        found[kind].append(person)
    return found


def false_belief_share(world_state: dict[str, Any]) -> int:
    """The percent of the named townsfolk who believe a falsehood about the conflict."""
    return 100 * len(believers(world_state)["false"]) // len(lore().people)


# ---------------------------------------------------------------------------- the reveal


def _clause(prop: Prop) -> dict[str, str]:
    """A prop said in both languages as a clause: the English capitalised, with no full stop."""
    lo = lore()
    said = lo.lines.statement(prop, lo.names)
    return {lang: capitalise(said[lang]) if lang == "en" else said[lang] for lang in LANGUAGES}


def truth_label(variant_id: str) -> dict[str, str]:
    """What the variant makes true about the conflict, as sentences in both languages.

    A variant that makes nothing of the conflict true has no sentence to say, and gets the
    script's own words, with no English.
    """
    sentences = [notebook.sentence(prop) for prop in true_conflict_props(variant_id)]
    if not sentences:
        return {"zh": lore().variants[variant_id].label, "en": ""}
    label = sentences[0]
    for sentence in sentences[1:]:
        label = phrases.joined(label, sentence)
    return label


def chain_label(props: list[str]) -> dict[str, str]:
    """The label of a chain, from the props of its hops: the first version against the last."""
    book = lore().book.props
    first, last = _clause(book[props[0]]), _clause(book[props[-1]])
    if props[0] == props[-1]:
        return first
    return {
        lang: CHAIN_LABEL[lang].format(first=first[lang], last=last[lang]) for lang in LANGUAGES
    }


def _chain(
    chain: dict[str, Any], world_state: dict[str, Any], variant: str
) -> dict[str, Any] | None:
    """One rumour chain of the script as the game made it, or ``None`` if it reached nobody."""
    section = world_state["social"]
    props = [hop["prop"] for hop in chain["hops"]]
    held: dict[str, list[list[Any]]] = {pid: [] for pid in props}
    for person in lore().people:
        for pid in props:
            note = section["beliefs"][person].get(pid)
            if note is None:
                continue
            belief = notes.decode_belief(person, pid, note)
            if belief.confidence > 0:
                held[pid].append([person, belief.confidence, belief.teller or "", belief.hop])
    reached = [
        person
        for person in lore().people
        if any(h[0] == person for pid in props[1:] for h in held[pid])
    ]
    if not reached:
        return None
    told = [
        [cid, c.speaker, c.listeners[0], c.prop, c.op or "", c.tick]
        for cid, c in social.claims(section).items()
        if c.prop in props
    ]
    book = lore().book.props
    return {
        "id": chain["id"],
        "label": chain_label(props),
        "texts": {pid: notebook.sentence(book[pid]) for pid in props},
        "planted": [[hop["prop"], hop["speaker"], hop["listener"]] for hop in chain["hops"]],
        "true": [pid for pid in props if lore().book.holds(variant, pid)],
        "told": told,
        "held": [[pid, held[pid]] for pid in props],
        "reached": reached,
    }


def reveal(world: BridgeWorld, world_state: dict[str, Any]) -> dict[str, Any]:
    """The reveal of a game that has just ended, from the state of the world."""
    from lantern_core.world.bridge import player  # not at the top: player may use goals

    section = world_state["social"]
    sides = believers(world_state)
    out: dict[str, Any] = {"truth": None, "chains": [], "believers": sides}
    out["told"] = {"total": 0, "mutated": 0}
    if "variant" in section:
        variant = section["variant"]
        chains = [_chain(c, world_state, variant) for c in SCRIPT["chains"]]
        out["truth"] = {
            "variant": variant,
            "label": truth_label(variant),
            "props": [p.id for p in true_conflict_props(variant)],
        }
        out["chains"] = [c for c in chains if c is not None]
        out["told"] = {"total": section["counts"]["told"], "mutated": section["counts"]["mutated"]}
    for module in (player, social):
        hook = getattr(module, "ending_reveal", None)
        if hook is not None:
            out[module.SECTION] = hook(world_state)
    return out
